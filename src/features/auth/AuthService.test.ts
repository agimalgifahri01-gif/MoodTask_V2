import type { SupabaseClient, User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { SupabaseAuthService } from './AuthService'

function mockClient() {
  let currentUser: User | null = null
  let signOutFailure: Error | null = null
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: currentUser }, error: null })),
    onAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: signOutFailure })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
  }
  return {
    auth,
    client: { auth } as unknown as SupabaseClient,
    setUser: (user: User | null) => {
      currentUser = user
    },
    failSignOut: (error: Error) => {
      signOutFailure = error
    },
  }
}

describe('SupabaseAuthService delegation with a mocked client', () => {
  it('requests a password-reset email with the recovery route', async () => {
    const fake = mockClient()
    const service = new SupabaseAuthService(fake.client)

    await service.requestPasswordReset('user@example.com')

    expect(fake.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
      { redirectTo: `${window.location.origin}/auth/recovery` },
    )
  })

  it('updates the password through the authenticated mock client', async () => {
    const fake = mockClient()
    const service = new SupabaseAuthService(fake.client)

    await service.updatePassword('a-test-password')

    expect(fake.auth.updateUser).toHaveBeenCalledWith({
      password: 'a-test-password',
    })
  })

  it('delegates logout and propagates service failures to its caller', async () => {
    const fake = mockClient()
    const service = new SupabaseAuthService(fake.client)
    await service.signOut()
    expect(fake.auth.signOut).toHaveBeenCalledOnce()

    fake.failSignOut(new Error('offline'))
    await expect(service.signOut()).rejects.toThrow('offline')
  })

  it('uses the verified user response when restoring a session', async () => {
    const user = { id: 'mock-user', email: 'user@example.com' } as User
    const fake = mockClient()
    fake.setUser(user)
    const service = new SupabaseAuthService(fake.client)

    await expect(service.getUser()).resolves.toEqual(user)
  })
})
