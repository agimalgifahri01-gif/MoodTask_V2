import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../features/tasks/domain'
import type { TaskRepository } from '../features/tasks/TaskRepository'
import { TaskProvider } from '../features/tasks/TaskProvider'
import TasksPage from './TasksPage'

const cloudRepository: TaskRepository = {
  list: async () => [],
  create: async (task: Task) => task,
  update: async (task: Task) => task,
  delete: async () => {},
}

function renderTasksPage(storageMode: 'local' | 'cloud' = 'local') {
  return render(
    <MemoryRouter initialEntries={['/tasks']}>
      <TaskProvider
        repository={storageMode === 'cloud' ? cloudRepository : undefined}
        storageMode={storageMode}
      >
        <Routes>
          <Route path="/tasks" element={<TasksPage />} />
        </Routes>
      </TaskProvider>
    </MemoryRouter>,
  )
}

describe('TasksPage', () => {
  it('opens a task requested by a notification link after loading its record', async () => {
    const task: Task = {
      id: '54d769f6-3c5a-43a7-a09b-2986ac74caa8',
      title: 'Tugas dari notifikasi',
      description: 'Dibuka dari push',
      startAt: '2026-01-01T00:00:00.000Z',
      deadlineAt: '2026-01-02T00:00:00.000Z',
      priority: 'medium',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
    }
    localStorage.setItem(
      'moodtask.tasks',
      JSON.stringify({ schemaVersion: 1, tasks: [task] }),
    )
    render(
      <MemoryRouter initialEntries={[`/tasks?open=${task.id}`]}>
        <TaskProvider>
          <Routes>
            <Route path="/tasks" element={<TasksPage />} />
          </Routes>
        </TaskProvider>
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('heading', { name: 'Tugas dari notifikasi' }),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'RINCIAN TUGAS' })).toBeTruthy()
  })

  it('creates, edits, completes, filters, and deletes a task', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTasksPage()
    await screen.findByRole('button', { name: 'Tugas baru' })

    fireEvent.click(screen.getByRole('button', { name: 'Tugas baru' }))
    fireEvent.change(
      screen.getByPlaceholderText('Contoh: Menyusun laporan mingguan'),
      {
        target: { value: 'Rangkuman materi' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))

    const taskButton = await screen.findByRole('button', {
      name: 'Buka rincian tugas Rangkuman materi',
    })
    expect(taskButton).toBeTruthy()
    const taskCard = taskButton.closest('article')
    expect(taskCard?.textContent).toContain('Santai')
    expect(taskCard?.querySelector('svg[data-expression="calm"]')).toBeTruthy()
    expect(taskCard?.textContent).not.toContain('Progres pekerjaan')

    fireEvent.click(taskButton)
    fireEvent.click(screen.getByRole('button', { name: 'Ubah tugas' }))
    const titleInput = screen.getByPlaceholderText(
      'Contoh: Menyusun laporan mingguan',
    )
    fireEvent.change(titleInput, { target: { value: 'Rangkuman bab tiga' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))

    await screen.findByRole('button', {
      name: 'Buka rincian tugas Rangkuman bab tiga',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }))

    await waitFor(() => {
      expect(
        within(screen.getByRole('article')).getByText('Selesai', {
          exact: true,
        }),
      ).toBeTruthy()
    })
    expect(
      within(screen.getByRole('article')).getByText('Bahagia'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Selesai1' }))
    expect(
      await screen.findByRole('button', {
        name: 'Buka rincian tugas Rangkuman bab tiga',
      }),
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Buka rincian tugas Rangkuman bab tiga',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hapus tugas' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('button', {
          name: 'Buka rincian tugas Rangkuman bab tiga',
        }),
      ).toBeNull()
    })
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('dari penyimpanan browser di perangkat ini?'),
    )
  })

  it('describes cloud deletion as removal from the MoodTask account', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTasksPage('cloud')
    await screen.findByRole('button', { name: 'Tugas baru' })

    fireEvent.click(screen.getByRole('button', { name: 'Tugas baru' }))
    fireEvent.change(
      screen.getByPlaceholderText('Contoh: Menyusun laporan mingguan'),
      { target: { value: 'Cloud test task' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Buka rincian tugas Cloud test task',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hapus tugas' }))

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('dari akun MoodTask?'),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: 'Buka rincian tugas Cloud test task',
        }),
      ).toBeNull(),
    )
  })
})
