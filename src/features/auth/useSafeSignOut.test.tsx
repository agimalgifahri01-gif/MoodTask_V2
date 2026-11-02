import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthContextValue } from './AuthContext'
import { AuthContext } from './AuthContext'
import type { ReminderSettingsValue } from '../reminders/ReminderSettingsContext'
import { ReminderSettingsContext } from '../reminders/ReminderSettingsContext'
import { useSafeSignOut } from './useSafeSignOut'

function createWrapper(
  disablePushBeforeSignOut: () => Promise<void>,
  signOut: () => Promise<void>,
) {
  const auth = { signOut } as unknown as AuthContextValue
  const reminders = {
    disablePushBeforeSignOut,
  } as unknown as ReminderSettingsValue

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AuthContext.Provider value={auth}>
        <ReminderSettingsContext.Provider value={reminders}>
          {children}
        </ReminderSettingsContext.Provider>
      </AuthContext.Provider>
    )
  }
}

describe('useSafeSignOut', () => {
  it('cleans the current browser push subscription before signing out', async () => {
    const calls: string[] = []
    const cleanup = vi.fn(async () => {
      calls.push('cleanup')
    })
    const signOut = vi.fn(async () => {
      calls.push('signOut')
    })
    const { result } = renderHook(() => useSafeSignOut(), {
      wrapper: createWrapper(cleanup, signOut),
    })

    await act(async () => result.current())

    expect(calls).toEqual(['cleanup', 'signOut'])
    expect(cleanup).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('does not sign out when push cleanup fails', async () => {
    const cleanup = vi.fn(async () => {
      throw new Error('Koneksi cleanup gagal.')
    })
    const signOut = vi.fn(async () => {})
    const { result } = renderHook(() => useSafeSignOut(), {
      wrapper: createWrapper(cleanup, signOut),
    })

    await expect(result.current()).rejects.toThrow('Koneksi cleanup gagal.')
    expect(signOut).not.toHaveBeenCalled()
  })
})
