import { describe, expect, it } from 'vitest'
import {
  getActiveTasksByUrgency,
  getCompletedTodayCount,
  getVisibleTasks,
} from './presentation'
import type { Task } from './domain'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Rangkuman materi',
    description: 'Baca bab tiga',
    startAt: '2026-10-22T08:00:00.000Z',
    deadlineAt: '2026-10-22T10:00:00.000Z',
    priority: 'medium',
    status: 'active',
    createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

describe('getVisibleTasks', () => {
  const tasks = [
    makeTask(),
    makeTask({
      id: 'task-2',
      title: 'Kirim email',
      description: '',
      priority: 'high',
      deadlineAt: '2026-10-22T09:00:00.000Z',
      createdAt: '2026-10-22T08:30:00.000Z',
    }),
    makeTask({
      id: 'task-3',
      description: '',
      status: 'completed',
      completedAt: '2026-10-22T08:45:00.000Z',
      createdAt: '2026-10-22T09:00:00.000Z',
    }),
  ]

  it('searches titles and descriptions without case sensitivity', () => {
    expect(
      getVisibleTasks(tasks, 'BAB TIGA', 'all', 'deadline').map(
        (task) => task.id,
      ),
    ).toEqual(['task-1'])
  })

  it('filters by status and sorts by priority or creation time', () => {
    expect(
      getVisibleTasks(tasks, '', 'active', 'priority').map((task) => task.id),
    ).toEqual(['task-2', 'task-1'])
    expect(
      getVisibleTasks(tasks, '', 'all', 'recent').map((task) => task.id),
    ).toEqual(['task-3', 'task-2', 'task-1'])
  })

  it('supports attention and completed-today dashboard filters', () => {
    const now = Date.parse('2026-10-22T09:00:00.000Z')
    const attentionTasks = getVisibleTasks(
      [
        makeTask({
          id: 'attention',
          startAt: '2026-10-22T08:00:00.000Z',
          deadlineAt: '2026-10-22T10:00:00.000Z',
        }),
        makeTask({ id: 'completed', status: 'completed' }),
      ],
      '',
      'attention',
      'deadline',
      now,
    )
    const completedTodayTasks = getVisibleTasks(
      [
        makeTask({
          id: 'completed-today',
          status: 'completed',
          completedAt: '2026-10-22T08:45:00.000Z',
        }),
        makeTask({
          id: 'completed-yesterday',
          status: 'completed',
          completedAt: '2026-10-21T08:45:00.000Z',
        }),
      ],
      '',
      'completed-today',
      'deadline',
      now,
    )

    expect(attentionTasks.map((task) => task.id)).toEqual(['attention'])
    expect(completedTodayTasks.map((task) => task.id)).toEqual([
      'completed-today',
    ])
  })
})

describe('getActiveTasksByUrgency', () => {
  it('orders by deadline percentage and skips completed tasks', () => {
    const tasks = [
      makeTask(),
      makeTask({
        id: 'task-2',
        startAt: '2026-10-22T08:00:00.000Z',
        deadlineAt: '2026-10-22T12:00:00.000Z',
      }),
      makeTask({ id: 'task-3', status: 'completed' }),
    ]
    expect(
      getActiveTasksByUrgency(
        tasks,
        Date.parse('2026-10-22T09:00:00.000Z'),
      ).map((task) => task.id),
    ).toEqual(['task-1', 'task-2'])
  })

  it('puts overdue tasks first, then sorts by the nearest absolute deadline', () => {
    const tasks = [
      makeTask({
        id: 'later-deadline',
        startAt: '2026-10-22T08:00:00.000Z',
        deadlineAt: '2026-10-22T12:00:00.000Z',
      }),
      makeTask({
        id: 'closer-deadline',
        startAt: '2026-10-22T09:30:00.000Z',
        deadlineAt: '2026-10-22T10:30:00.000Z',
      }),
      makeTask({
        id: 'overdue',
        startAt: '2026-10-22T08:00:00.000Z',
        deadlineAt: '2026-10-22T09:55:00.000Z',
      }),
    ]

    expect(
      getActiveTasksByUrgency(
        tasks,
        Date.parse('2026-10-22T10:00:00.000Z'),
      ).map((task) => task.id),
    ).toEqual(['overdue', 'closer-deadline', 'later-deadline'])
  })
})

describe('getCompletedTodayCount', () => {
  it('counts completed tasks by the user’s local calendar day', () => {
    const tasks = [
      makeTask({
        status: 'completed',
        completedAt: '2026-10-22T08:00:00.000Z',
      }),
      makeTask({
        id: 'task-2',
        status: 'completed',
        completedAt: '2026-10-21T08:00:00.000Z',
      }),
      makeTask({ id: 'task-3', status: 'cancelled', completedAt: null }),
    ]
    expect(
      getCompletedTodayCount(tasks, Date.parse('2026-10-22T12:00:00.000Z')),
    ).toBe(1)
  })
})
