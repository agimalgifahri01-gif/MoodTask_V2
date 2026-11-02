import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import {
  AuthContext,
  type AuthContextValue,
} from '../features/auth/AuthContext'
import type { AuthService } from '../features/auth/AuthService'
import AuthPage from './AuthPage'

function LocationView() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderAuthPage({ recovery = false, signedIn = false } = {}) {
  const service: AuthService = {
    getUser: vi.fn(async () => null),
    subscribe: vi.fn(() => () => {}),
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => false),
    signOut: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => {}),
  }
  const context: AuthContextValue = {
    status: signedIn ? 'signed-in' : 'signed-out',
    user: null,
    authError: null,
    configurationError: null,
    service,
    client: null,
    signIn: service.signIn,
    signUp: service.signUp,
    signOut: service.signOut,
    requestPasswordReset: service.requestPasswordReset,
    updatePassword: service.updatePassword,
  }
  const view = render(
    <AuthContext.Provider value={context}>
      <MemoryRouter initialEntries={[recovery ? '/auth/recovery' : '/auth']}>
        <AuthPage recovery={recovery} />
        <LocationView />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  return { ...view, service }
}

describe('AuthPage with injected auth-service mocks', () => {
  it('requests a password reset with a normalized email and shows neutral feedback', async () => {
    const { service } = renderAuthPage()
    fireEvent.click(screen.getByRole('button', { name: 'Lupa kata sandi?' }))
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'USER@Example.com' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Kirim tautan pemulihan' }),
    )

    expect(service.requestPasswordReset).toHaveBeenCalledWith(
      'user@example.com',
    )
    expect(
      await screen.findByText(
        /Jika email terdaftar, tautan pemulihan akan dikirim/,
      ),
    ).toBeTruthy()
  })

  it('keeps password-update success visible on the recovery route', async () => {
    const { service } = renderAuthPage({ recovery: true, signedIn: true })
    fireEvent.change(screen.getByLabelText('Kata sandi baru'), {
      target: { value: 'new-test-password' },
    })
    fireEvent.change(screen.getByLabelText('Ulangi kata sandi'), {
      target: { value: 'new-test-password' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Simpan kata sandi baru' }),
    )

    expect(service.updatePassword).toHaveBeenCalledWith('new-test-password')
    expect(
      await screen.findByText(/Kata sandi berhasil diperbarui/),
    ).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe('/auth/recovery')
  })

  it('rejects a mismatched recovery confirmation before calling the service', async () => {
    const { service } = renderAuthPage({ recovery: true, signedIn: true })
    fireEvent.change(screen.getByLabelText('Kata sandi baru'), {
      target: { value: 'new-test-password' },
    })
    fireEvent.change(screen.getByLabelText('Ulangi kata sandi'), {
      target: { value: 'different-test-password' },
    })
    const submit = screen.getByRole('button', {
      name: 'Simpan kata sandi baru',
    })
    const form = submit.closest('form')
    if (!form) throw new Error('Form autentikasi tidak ditemukan.')
    fireEvent.submit(form)

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Konfirmasi kata sandi belum sama.',
      ),
    )
    expect(service.updatePassword).not.toHaveBeenCalled()
  })
})
