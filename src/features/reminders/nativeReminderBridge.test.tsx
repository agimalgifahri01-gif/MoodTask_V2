import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../tasks/domain'
import { TaskContext, type TaskContextValue } from '../tasks/TaskContext'
import type { TaskReminder } from './model'
import {
  ReminderSettingsContext,
  type ReminderSettingsValue,
} from './ReminderSettingsContext'
import { NativeReminderBridge } from './nativeReminderBridge'
import { buildNativeReminderSnapshot } from './nativeReminder'

const { invoke, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  isTauri: vi.fn(() => true),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }))

const activeTask: Task = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Belajar Rust',
  description: '',
  startAt: '2026-11-01T00:00:00.000Z',
  deadlineAt: '2026-11-02T00:00:00.000Z',
  priority: 'medium',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  completedAt: null,
}

const completedTask: Task = {
  ...activeTask,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Sudah selesai',
  status: 'completed',
  completedAt: '2026-11-01T01:00:00.000Z',
}

const activeReminder: TaskReminder = {
  id: '33333333-3333-4333-8333-333333333333',
  taskId: activeTask.id,
  minutesBefore: 15,
  enabled: true,
  createdAt: '2026-11-01T00:00:00.000Z',
}

const completedReminder: TaskReminder = {
  ...activeReminder,
  id: '44444444-4444-4444-8444-444444444444',
  taskId: completedTask.id,
}

function contextValues(overrides?: {
  tasks?: Task[]
  tasksLoading?: boolean
  loadError?: string | null
  reminders?: TaskReminder[]
  remindersLoading?: boolean
  reminderError?: string | null
  listenerActive?: boolean
}) {
  const taskValue = {
    tasks: overrides?.tasks ?? [activeTask],
    loading: overrides?.tasksLoading ?? false,
    loadError: overrides?.loadError ?? null,
  } as TaskContextValue
  const reminderValue = {
    reminders: overrides?.reminders ?? [activeReminder],
    loading: overrides?.remindersLoading ?? false,
    error: overrides?.reminderError ?? null,
    nativeSoundDiagnostics: {
      listenerActive: overrides?.listenerActive ?? true,
      eventReceived: false,
      audioUrlStatus: 'unknown',
      playbackStatus: 'unknown',
      error: null,
    },
  } as ReminderSettingsValue
  return { taskValue, reminderValue }
}

function renderBridge(
  overrides?: Parameters<typeof contextValues>[0],
  props = {
    ownerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionReady: true,
  },
) {
  const { taskValue, reminderValue } = contextValues(overrides)
  return render(
    <TaskContext.Provider value={taskValue}>
      <ReminderSettingsContext.Provider value={reminderValue}>
        <NativeReminderBridge {...props} />
      </ReminderSettingsContext.Provider>
    </TaskContext.Provider>,
  )
}

describe('native reminder bridge', () => {
  it('builds a task snapshot without completed tasks or their reminders', () => {
    const snapshot = buildNativeReminderSnapshot(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      [activeTask, completedTask],
      [activeReminder, completedReminder],
    )

    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]).toMatchObject({
      id: activeTask.id,
      deadlineAtMs: Date.parse(activeTask.deadlineAt),
      status: 'active',
    })
    expect(snapshot.reminders).toEqual([
      {
        id: activeReminder.id,
        taskId: activeTask.id,
        minutesBefore: 15,
        enabled: true,
      },
    ])
  })

  it('syncs only after task and reminder repositories have loaded', async () => {
    invoke.mockClear()
    renderBridge({ tasksLoading: true })
    expect(invoke).not.toHaveBeenCalled()

    invoke.mockClear()
    renderBridge()
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    expect(invoke).toHaveBeenCalledWith(
      'sync_native_reminder_snapshot',
      expect.objectContaining({
        snapshot: expect.objectContaining({
          tasks: [expect.objectContaining({ id: activeTask.id })],
          reminders: [expect.objectContaining({ id: activeReminder.id })],
        }),
      }),
    )
  })

  it('does not replace a valid native snapshot with empty data on load errors', () => {
    invoke.mockClear()
    renderBridge({ loadError: 'offline' })
    expect(invoke).not.toHaveBeenCalled()
    renderBridge({ reminderError: 'offline' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not sync before the native account session is prepared', () => {
    invoke.mockClear()
    renderBridge(undefined, {
      ownerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sessionReady: false,
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('waits for the native event listener before arming the snapshot', async () => {
    invoke.mockClear()
    const view = renderBridge({ listenerActive: false })
    expect(invoke).not.toHaveBeenCalled()
    const values = contextValues({ listenerActive: true })
    await act(async () => {
      view.rerender(
        <TaskContext.Provider value={values.taskValue}>
          <ReminderSettingsContext.Provider value={values.reminderValue}>
            <NativeReminderBridge
              ownerUserId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              sessionReady
            />
          </ReminderSettingsContext.Provider>
        </TaskContext.Provider>,
      )
    })
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    expect(invoke).toHaveBeenCalledWith(
      'sync_native_reminder_snapshot',
      expect.any(Object),
    )
  })

  it('refreshes the native snapshot after task changes', async () => {
    invoke.mockClear()
    const first = renderBridge()
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const updated = { ...activeTask, title: 'Belajar Rust diperbarui' }
    const values = contextValues({ tasks: [updated] })
    await act(async () => {
      first.rerender(
        <TaskContext.Provider value={values.taskValue}>
          <ReminderSettingsContext.Provider value={values.reminderValue}>
            <NativeReminderBridge
              ownerUserId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              sessionReady
            />
          </ReminderSettingsContext.Provider>
        </TaskContext.Provider>,
      )
    })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'sync_native_reminder_snapshot',
      expect.objectContaining({
        snapshot: expect.objectContaining({
          tasks: [expect.objectContaining({ title: updated.title })],
        }),
      }),
    )
  })
})
