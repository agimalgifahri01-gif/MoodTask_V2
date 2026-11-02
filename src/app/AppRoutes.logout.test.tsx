import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './App'

const { useAuthMock, useTasksMock, safeSignOut } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useTasksMock: vi.fn(),
  safeSignOut: vi.fn(async () => {}),
}))

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: useAuthMock,
}))

vi.mock('../features/tasks/TaskContext', () => ({
  useTasks: useTasksMock,
}))

vi.mock('../features/auth/useSafeSignOut', () => ({
  useSafeSignOut: () => safeSignOut,
}))

describe('AppRoutes leaveAccount logout', () => {
  beforeEach(() => {
    safeSignOut.mockReset()
    safeSignOut.mockResolvedValue()
    useAuthMock.mockReturnValue({ user: { id: 'user-a' } })
    useTasksMock.mockReturnValue({
      loading: false,
      loadError: 'Tugas belum dapat dimuat.',
      reload: vi.fn(),
    })
  })

  it('uses the same safe sign-out mechanism from the load-error action', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Keluar dari akun' }))

    expect(safeSignOut).toHaveBeenCalledOnce()
  })
})
