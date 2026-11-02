import { createContext, useContext } from 'react'
import type { PushCapability } from './browserPush'
import type { TaskReminder } from './model'
import type { Task } from '../tasks/domain'
import type { NotificationSoundPreference } from './notificationSound'

export type ReminderSettingsValue = {
  repositoryAvailable: boolean
  reminders: TaskReminder[]
  loading: boolean
  error: string | null
  pushCapability: PushCapability
  pushSubscribed: boolean
  pushBusy: boolean
  soundPreference: NotificationSoundPreference
  soundLoading: boolean
  soundSaving: boolean
  soundError: string | null
  refresh: () => Promise<void>
  saveReminder: (
    task: Task,
    minutesBefore: number,
    enabled?: boolean,
  ) => Promise<TaskReminder>
  removeReminder: (id: string) => Promise<void>
  enablePush: () => Promise<void>
  disablePush: () => Promise<void>
  disablePushBeforeSignOut: () => Promise<void>
  saveNotificationSound: (
    preference: NotificationSoundPreference,
  ) => Promise<void>
  uploadAndSaveNotificationSound: (
    file: File,
    contentType: string,
    extension: string,
    fileName: string,
    muted: boolean,
  ) => Promise<NotificationSoundPreference>
  getNotificationSoundUrl: (path: string) => Promise<string>
  playConfiguredNotificationSound: (eventId: string) => Promise<void>
  clearSoundError: () => void
  clearError: () => void
}

export const ReminderSettingsContext =
  createContext<ReminderSettingsValue | null>(null)

export function useReminderSettings() {
  const context = useContext(ReminderSettingsContext)
  if (!context) {
    throw new Error(
      'useReminderSettings harus dipakai di dalam ReminderSettingsProvider.',
    )
  }
  return context
}

export function useOptionalReminderSettings() {
  return useContext(ReminderSettingsContext)
}

export { ReminderSettingsProvider } from './ReminderSettingsProvider'
