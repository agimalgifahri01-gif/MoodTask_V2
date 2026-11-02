import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppLayout from './AppLayout'

const { safeSignOut } = vi.hoisted(() => ({
  safeSignOut: vi.fn(async () => {}),
}))

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'user@example.com' } }),
}))

vi.mock('../features/auth/useSafeSignOut', () => ({
  useSafeSignOut: () => safeSignOut,
}))

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<p>Workspace</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppLayout logout', () => {
  beforeEach(() => {
    safeSignOut.mockReset()
    safeSignOut.mockResolvedValue()
  })

  it('uses the shared safe sign-out mechanism', async () => {
    renderLayout()
    fireEvent.click(screen.getByRole('button', { name: 'Keluar dari akun' }))

    expect(safeSignOut).toHaveBeenCalledOnce()
  })

  it('shows cleanup failure and does not claim logout succeeded', async () => {
    safeSignOut.mockRejectedValueOnce(new Error('Koneksi cleanup gagal.'))
    renderLayout()
    fireEvent.click(screen.getByRole('button', { name: 'Keluar dari akun' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Koneksi cleanup gagal.',
    )
  })
})
