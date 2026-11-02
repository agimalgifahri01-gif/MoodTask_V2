import { describe, expect, it } from 'vitest'
import { getCharacterMessage } from '../character/messages'
import type { Task } from '../tasks/domain'
import {
  createReminderNotification,
  formatReminderOffset,
  getReminderDurationMinutes,
  getDueTaskReminders,
  ReminderValidationError,
  validateNewReminderSchedule,
  validateReminderOffset,
  type TaskReminder,
} from './model'

const start = Date.parse('2026-01-01T00:00:00.000Z')
const deadline = start + 60 * 60_000

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Menyusun rencana',
    description: '',
    startAt: new Date(start).toISOString(),
    deadlineAt: new Date(deadline).toISOString(),
    priority: 'medium',
    status: 'active',
    createdAt: new Date(start).toISOString(),
    updatedAt: new Date(start).toISOString(),
    completedAt: null,
    ...overrides,
  }
}

function makeReminder(
  minutesBefore: number,
  overrides: Partial<TaskReminder> = {},
): TaskReminder {
  return {
    id: `reminder-${minutesBefore}`,
    taskId: 'task-1',
    minutesBefore,
    enabled: true,
    createdAt: new Date(start).toISOString(),
    ...overrides,
  }
}

describe('reminder schedule domain', () => {
  it.each([
    [{ days: '', hours: '', minutes: '45' }, 45],
    [{ days: '', hours: '2', minutes: '' }, 120],
    [{ days: '3', hours: '', minutes: '' }, 4_320],
    [{ days: '', hours: '2', minutes: '30' }, 150],
  ])(
    'converts custom day/hour/minute input %o to minutes',
    (input, expected) => {
      expect(getReminderDurationMinutes(input)).toBe(expected)
    },
  )

  it('rejects zero, negative, fractional, and over-limit custom durations', () => {
    expect(
      getReminderDurationMinutes({ days: '', hours: '', minutes: '' }),
    ).toBeNull()
    for (const input of [
      { days: '0', hours: '0', minutes: '0' },
      { days: '', hours: '-1', minutes: '' },
      { days: '', hours: '1.5', minutes: '' },
      { days: '366', hours: '', minutes: '' },
    ]) {
      expect(() => getReminderDurationMinutes(input)).toThrow(
        ReminderValidationError,
      )
    }
  })

  it('formats a combined custom duration without losing its units', () => {
    expect(formatReminderOffset(150)).toBe('2 jam 30 menit')
    expect(formatReminderOffset(4_320)).toBe('3 hari')
  })

  it('accepts a future reminder and rejects a reminder time that has passed', () => {
    const now = start + 30 * 60_000
    expect(() =>
      validateNewReminderSchedule(
        new Date(start).toISOString(),
        new Date(deadline).toISOString(),
        15,
        now,
      ),
    ).not.toThrow()
    expect(() =>
      validateNewReminderSchedule(
        new Date(start).toISOString(),
        new Date(deadline).toISOString(),
        45,
        now,
      ),
    ).toThrow('Waktu pengingat sudah lewat')
  })

  it('accepts a custom offset inside the task time range', () => {
    expect(() => validateReminderOffset(makeTask(), 30)).not.toThrow()
  })

  it('rejects zero, fractional, oversized, and pre-start reminder times', () => {
    for (const offset of [0, 0.5, 525_601, 60]) {
      expect(() => validateReminderOffset(makeTask(), offset)).toThrow(
        ReminderValidationError,
      )
    }
  })

  it('recalculates a scheduled instant from the current task deadline', () => {
    const reminder = makeReminder(10)
    const originalDue = getDueTaskReminders(
      [makeTask()],
      [reminder],
      start + 50 * 60_000,
    )
    expect(originalDue).toHaveLength(1)
    expect(originalDue[0].scheduledAt).toBe(start + 50 * 60_000)

    const editedTask = makeTask({
      deadlineAt: new Date(start + 120 * 60_000).toISOString(),
    })
    expect(
      getDueTaskReminders([editedTask], [reminder], start + 50 * 60_000),
    ).toHaveLength(0)
    const afterEditedDeadlineOffset = getDueTaskReminders(
      [editedTask],
      [reminder],
      start + 110 * 60_000,
    )
    expect(afterEditedDeadlineOffset[0].scheduledAt).toBe(start + 110 * 60_000)
  })

  it('does not deliver disabled reminders or continue after task completion or cancellation', () => {
    const reminder = makeReminder(10)
    expect(
      getDueTaskReminders(
        [makeTask()],
        [{ ...reminder, enabled: false }],
        deadline,
      ),
    ).toEqual([])
    expect(
      getDueTaskReminders(
        [
          makeTask({
            status: 'completed',
            completedAt: new Date(deadline).toISOString(),
          }),
        ],
        [reminder],
        deadline,
      ),
    ).toEqual([])
    expect(
      getDueTaskReminders(
        [makeTask({ status: 'cancelled' })],
        [reminder],
        deadline,
      ),
    ).toEqual([])
  })

  it('returns only the latest missed schedule for an overdue task', () => {
    const due = getDueTaskReminders(
      [makeTask()],
      [makeReminder(45), makeReminder(10)],
      deadline + 5 * 60_000,
    )
    expect(due).toHaveLength(1)
    expect(due[0].reminder.minutesBefore).toBe(10)
    expect(due[0].mood).toBe('late')
  })
})

describe('Momo reminder notification mood', () => {
  it.each([
    [100, 'calm', 'Santai'],
    [90, 'calm', 'Santai'],
    [76, 'calm', 'Santai'],
    [75, 'alert', 'Waspada'],
    [51, 'alert', 'Waspada'],
    [50, 'anxious', 'Cemas'],
    [26, 'anxious', 'Cemas'],
    [25, 'panic', 'Panik'],
    [1, 'panic', 'Panik'],
    [0, 'late', 'Terlambat'],
    [-10, 'late', 'Terlambat'],
  ] as const)(
    'uses current deadline percentage %i for mood %s',
    (percentage, mood, label) => {
      const task = makeTask()
      const now = deadline - (deadline - start) * (percentage / 100)
      const notification = createReminderNotification(
        task,
        makeReminder(10),
        now,
      )
      expect(notification?.mood).toBe(mood)
      expect(notification?.title).toContain(label)
      expect(notification?.body).toContain(task.title)
      expect(notification?.icon).toBe(`/momo/${mood}.svg`)
    },
  )

  it('uses Bahagia for a completed task even after its deadline', () => {
    const task = makeTask({
      status: 'completed',
      completedAt: new Date(deadline).toISOString(),
    })
    const notification = createReminderNotification(
      task,
      makeReminder(10),
      deadline + 24 * 60 * 60_000,
    )
    expect(notification?.mood).toBe('happy')
    expect(notification?.title).toContain('Bahagia')
    expect(notification?.body).toContain(getCharacterMessage('happy', task.id))
  })

  it('uses a stable deduplication tag per rule and task deadline revision', () => {
    const reminder = makeReminder(10)
    const first = createReminderNotification(makeTask(), reminder, start)
    const repeated = createReminderNotification(makeTask(), reminder, start + 1)
    const edited = createReminderNotification(
      makeTask({ deadlineAt: new Date(deadline + 60_000).toISOString() }),
      reminder,
      start + 1,
    )
    expect(first?.tag).toBe(repeated?.tag)
    expect(edited?.tag).not.toBe(first?.tag)
  })
})
