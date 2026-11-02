import { useCallback } from 'react'
import { useReminderSettings } from '../reminders/ReminderSettingsContext'
import { useAuth } from './AuthContext'

/** Clean up this browser's push route before ending the active account session. */
export function useSafeSignOut() {
  const { signOut } = useAuth()
  const { disablePushBeforeSignOut } = useReminderSettings()

  return useCallback(async () => {
    await disablePushBeforeSignOut()
    await signOut()
  }, [disablePushBeforeSignOut, signOut])
}
