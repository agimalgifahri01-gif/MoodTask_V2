import type { PushSubscriptionData, TaskReminder } from './model'
import type { NotificationSoundPreference } from './notificationSound'

export interface ReminderRepository {
  list(): Promise<TaskReminder[]>
  saveReminder(
    taskId: string,
    minutesBefore: number,
    enabled: boolean,
  ): Promise<TaskReminder>
  removeReminder(id: string): Promise<void>
  getPushSubscriptionOrigin(endpoint: string): Promise<string | null>
  savePushSubscription(subscription: PushSubscriptionData): Promise<void>
  removePushSubscription(endpoint: string): Promise<void>
  getNotificationSoundPreference(): Promise<NotificationSoundPreference | null>
  saveNotificationSoundPreference(
    preference: NotificationSoundPreference,
  ): Promise<void>
  uploadNotificationSound(
    file: File,
    contentType: string,
    extension: string,
  ): Promise<string>
  getNotificationSoundUrl(path: string): Promise<string>
  removeNotificationSound(path: string): Promise<void>
}
