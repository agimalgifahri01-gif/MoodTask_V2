import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './AuthContext'
import type { AuthService } from './AuthService'

const testUser = { id: 'user-a', email: 'momo@example.com' } as User
const secondTestUser = { id: 'user-b', email: 'second@example.com' } as User

function createService(initialUser: User | null = null): AuthService {
  let currentUser = initialUser
  let listener: ((user: User | null) => void) | null = null
  return {
    getUser: async () => currentUser,
    subscribe: (callback) => {
      listener = callback
      return () => {
        listener = null
      }
    },
    signIn: async (email) => {
      currentUser = email === secondTestUser.email ? secondTestUser : testUser
      listener?.(currentUser)
    },
    signUp: async () => false,
    signOut: async () => {
      currentUser = null
      listener?.(null)
    },
    requestPasswordReset: async () => {},
    updatePassword: async () => {},
  }
}

function AuthStateView() {
  const { status, user, signIn, signOut } = useAuth()
  return (
    <div>
      <output data-testid="status">{status}</output>
      <output data-testid="user">{user?.id ?? ''}</output>
      <button onClick={() => void signIn('momo@example.com', 'password')}>
        Masuk akun A
      </button>
      <button onClick={() => void signIn('second@example.com', 'password')}>
        Masuk akun B
      </button>
      <button onClick={() => void signOut()}>Keluar</button>
    </div>
  )
}

function AuthErrorView() {
  const { signIn } = useAuth()
  const [error, setError] = useState('')
  return (
    <div>
      <button
        onClick={async () => {
          try {
            await signIn('momo@example.com', 'wrong')
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'error')
          }
        }}
      >
        Masuk gagal
      </button>
      <output role="alert">{error}</output>
    </div>
  )
}

describe('AuthProvider', () => {
  it('restores a session from the injected auth-service mock', async () => {
    render(
      <AuthProvider service={createService(testUser)} configError={null}>
        <AuthStateView />
      </AuthProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('signed-in'),
    )
    expect(screen.getByTestId('user').textContent).toBe('user-a')
  })

  it('remains signed out until the auth service confirms login', async () => {
    render(
      <AuthProvider service={createService()} configError={null}>
        <AuthStateView />
      </AuthProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('signed-out'),
    )
    expect(screen.getByTestId('user').textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Masuk akun A' }))
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('signed-in'),
    )
    expect(screen.getByTestId('user').textContent).toBe('user-a')
  })

  it('returns to signed-out after the mocked service logs out', async () => {
    render(
      <AuthProvider service={createService(testUser)} configError={null}>
        <AuthStateView />
      </AuthProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('signed-in'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Keluar' }))
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('signed-out'),
    )
    expect(screen.getByTestId('user').textContent).toBe('')
  })

  it('switches identities after logout and a second mocked login', async () => {
    render(
      <AuthProvider service={createService(testUser)} configError={null}>
        <AuthStateView />
      </AuthProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('user-a'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Keluar' }))
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('signed-out'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Masuk akun B' }))
    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('user-b'),
    )
  })

  it('does not claim a session when Supabase configuration is absent', () => {
    render(
      <AuthProvider service={null} configError="Missing project configuration">
        <AuthStateView />
      </AuthProvider>,
    )
    expect(screen.getByTestId('status').textContent).toBe('unconfigured')
    expect(screen.getByTestId('user').textContent).toBe('')
  })

  it('does not claim an account session when session verification fails', async () => {
    const service = createService()
    service.getUser = async () => {
      throw new Error('Failed to fetch')
    }
    render(
      <AuthProvider service={service} configError={null}>
        <AuthStateView />
      </AuthProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('unavailable'),
    )
    expect(screen.getByTestId('user').textContent).toBe('')
  })

  it('shows a helpful credential error rather than a backend message', async () => {
    const service = createService()
    service.signIn = async () => {
      throw new Error('Invalid login credentials')
    }
    render(
      <AuthProvider service={service} configError={null}>
        <AuthErrorView />
      </AuthProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Masuk gagal' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Email atau password tidak sesuai.',
      ),
    )
  })
})
