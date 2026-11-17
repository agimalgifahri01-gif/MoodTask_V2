import { useCallback } from 'react'
import { useReminderSettings } from '../reminders/ReminderSettingsContext'
import { useAuth } from './AuthContext'
import { clearNativeReminderSnapshot } from '../reminders/nativeReminder'

/** Clean up this browser's push route before ending the active account session. */
export function useSafeSignOut() {
  const { signOut } = useAuth()
  const { disablePushBeforeSignOut } = useReminderSettings()

  return useCallback(async () => {
    await disablePushBeforeSignOut()
    await clearNativeReminderSnapshot()
    await signOut()
  }, [disablePushBeforeSignOut, signOut])
}
