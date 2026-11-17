import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuthContextValue } from './AuthContext'
import { AuthContext } from './AuthContext'
import type { ReminderSettingsValue } from '../reminders/ReminderSettingsContext'
import { ReminderSettingsContext } from '../reminders/ReminderSettingsContext'
import { useSafeSignOut } from './useSafeSignOut'

const { clearNative } = vi.hoisted(() => ({
  clearNative: vi.fn(async () => {}),
}))

vi.mock('../reminders/nativeReminder', () => ({
  clearNativeReminderSnapshot: clearNative,
}))

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
  it('cleans push and native reminders before signing out', async () => {
    clearNative.mockReset()
    const calls: string[] = []
    const cleanup = vi.fn(async () => {
      calls.push('push-cleanup')
    })
    clearNative.mockImplementation(async () => {
      calls.push('native-cleanup')
    })
    const signOut = vi.fn(async () => {
      calls.push('sign-out')
    })
    const { result } = renderHook(() => useSafeSignOut(), {
      wrapper: createWrapper(cleanup, signOut),
    })

    await act(async () => result.current())

    expect(calls).toEqual(['push-cleanup', 'native-cleanup', 'sign-out'])
    expect(clearNative).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('does not sign out when push cleanup fails', async () => {
    clearNative.mockReset()
    const cleanup = vi.fn(async () => {
      throw new Error('Koneksi cleanup gagal.')
    })
    const signOut = vi.fn(async () => {})
    const { result } = renderHook(() => useSafeSignOut(), {
      wrapper: createWrapper(cleanup, signOut),
    })

    await expect(result.current()).rejects.toThrow('Koneksi cleanup gagal.')
    expect(clearNative).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does not sign out when native reminder cleanup fails', async () => {
    clearNative
      .mockReset()
      .mockRejectedValueOnce(new Error('Native cleanup gagal.'))
    const signOut = vi.fn(async () => {})
    const { result } = renderHook(() => useSafeSignOut(), {
      wrapper: createWrapper(async () => {}, signOut),
    })

    await expect(result.current()).rejects.toThrow('Native cleanup gagal.')
    expect(signOut).not.toHaveBeenCalled()
  })
})
