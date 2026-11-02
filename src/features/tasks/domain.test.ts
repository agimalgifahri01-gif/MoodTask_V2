import { describe, expect, it } from 'vitest'
import {
  calculateDeadlineState,
  getTaskMood,
  TaskValidationError,
  validateTaskDraft,
  type Task,
} from './domain'

const startAt = '2026-10-22T00:00:00.000Z'
const deadlineAt = '2026-10-22T01:00:00.000Z'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Selesaikan laporan',
    description: '',
    startAt,
    deadlineAt,
    priority: 'medium',
    status: 'active',
    createdAt: startAt,
    updatedAt: startAt,
    completedAt: null,
    ...overrides,
  }
}

describe('calculateDeadlineState', () => {
  it('clamps future starts to 100% while preserving the raw value', () => {
    const state = calculateDeadlineState(
      startAt,
      deadlineAt,
      Date.parse(startAt) - 1_000,
    )
    expect(state.remainingPercentage).toBe(100)
    expect(state.rawRemainingPercentage).toBeGreaterThan(100)
    expect(state.isOverdue).toBe(false)
  })

  it('keeps overdue information while clamping display percentage to zero', () => {
    const state = calculateDeadlineState(
      startAt,
      deadlineAt,
      Date.parse(deadlineAt) + 1,
    )
    expect(state.remainingPercentage).toBe(0)
    expect(state.rawRemainingPercentage).toBeLessThan(0)
    expect(state.isOverdue).toBe(true)
  })

  it('rejects invalid dates and a zero-length time range', () => {
    expect(() => calculateDeadlineState('no-date', deadlineAt, 0)).toThrow(
      TaskValidationError,
    )
    expect(() => calculateDeadlineState(startAt, startAt, 0)).toThrow(
      'Deadline harus setelah waktu mulai.',
    )
  })
})

describe('getTaskMood', () => {
  it.each([
    [76, 'calm'],
    [75, 'alert'],
    [51, 'alert'],
    [50, 'anxious'],
    [26, 'anxious'],
    [25, 'panic'],
    [1, 'panic'],
    [0, 'late'],
  ] as const)('maps %s%% remaining to %s', (percentage, mood) => {
    const now = Date.parse(deadlineAt) - percentage * 36_000
    expect(getTaskMood(makeTask(), now)).toBe(mood)
  })

  it('uses happy for a completed task even after its deadline', () => {
    expect(
      getTaskMood(
        makeTask({ status: 'completed' }),
        Date.parse(deadlineAt) + 60_000,
      ),
    ).toBe('happy')
  })

  it('marks an unfinished task late after its deadline has passed', () => {
    expect(getTaskMood(makeTask(), Date.parse(deadlineAt) + 1)).toBe('late')
  })

  it('updates mood when the deadline changes for the same task', () => {
    const now = Date.parse('2026-10-22T00:30:00.000Z')
    expect(getTaskMood(makeTask(), now)).toBe('anxious')
    expect(
      getTaskMood(makeTask({ deadlineAt: '2026-10-22T03:00:00.000Z' }), now),
    ).toBe('calm')
  })

  it('does not assign a mood to a cancelled task', () => {
    expect(
      getTaskMood(makeTask({ status: 'cancelled' }), Date.parse(deadlineAt)),
    ).toBeNull()
  })
})

describe('validateTaskDraft', () => {
  const draft = {
    title: '  Selesaikan laporan  ',
    description: '  Catatan  ',
    startAt,
    deadlineAt,
    priority: 'high' as const,
  }

  it('trims text and accepts valid task fields', () => {
    expect(validateTaskDraft(draft)).toMatchObject({
      title: 'Selesaikan laporan',
      description: 'Catatan',
    })
  })

  it('rejects blank titles and reversed dates', () => {
    expect(() => validateTaskDraft({ ...draft, title: '   ' })).toThrow(
      'Judul tugas wajib diisi.',
    )
    expect(() => validateTaskDraft({ ...draft, deadlineAt: startAt })).toThrow(
      'Deadline harus setelah waktu mulai.',
    )
  })
})
