import { invoke, isTauri } from '@tauri-apps/api/core'
import type { Task } from '../tasks/domain'
import type { TaskReminder } from './model'

export type NativeReminderTask = {
  id: string
  title: string
  startAtMs: number
  deadlineAtMs: number
  status: Task['status']
}

export type NativeReminderEntry = {
  id: string
  taskId: string
  minutesBefore: number
  enabled: boolean
}

export type NativeReminderSnapshot = {
  ownerUserId: string
  tasks: NativeReminderTask[]
  reminders: NativeReminderEntry[]
}

export function buildNativeReminderSnapshot(
  ownerUserId: string,
  tasks: Task[],
  reminders: TaskReminder[],
): NativeReminderSnapshot {
  const activeTasks = tasks.filter((task) => task.status === 'active')
  const nativeTasks = activeTasks.map((task) => {
    const startAtMs = Date.parse(task.startAt)
    const deadlineAtMs = Date.parse(task.deadlineAt)
    if (
      !Number.isFinite(startAtMs) ||
      !Number.isFinite(deadlineAtMs) ||
      deadlineAtMs <= startAtMs
    ) {
      throw new Error('Data waktu tugas tidak valid untuk pengingat desktop.')
    }
    return {
      id: task.id,
      title: task.title,
      startAtMs,
      deadlineAtMs,
      status: task.status,
    }
  })
  const activeTaskIds = new Set(activeTasks.map((task) => task.id))
  return {
    ownerUserId,
    tasks: nativeTasks,
    reminders: reminders
      .filter(
        (reminder) => reminder.enabled && activeTaskIds.has(reminder.taskId),
      )
      .map((reminder) => ({
        id: reminder.id,
        taskId: reminder.taskId,
        minutesBefore: reminder.minutesBefore,
        enabled: reminder.enabled,
      })),
  }
}

export async function prepareNativeReminderSession(
  ownerUserId: string | null,
): Promise<void> {
  if (!isTauri()) return
  await invoke('prepare_native_reminder_session', { ownerUserId })
}

export async function syncNativeReminderSnapshot(
  snapshot: NativeReminderSnapshot,
): Promise<void> {
  if (!isTauri()) return
  await invoke('sync_native_reminder_snapshot', { snapshot })
}

export async function acknowledgeNativeReminderEvent(
  eventId: string,
): Promise<void> {
  if (!isTauri()) return
  await invoke('acknowledge_native_reminder_event', { eventId })
}

export async function clearNativeReminderSnapshot(): Promise<void> {
  if (!isTauri()) return
  await invoke('clear_native_reminder_snapshot')
}
