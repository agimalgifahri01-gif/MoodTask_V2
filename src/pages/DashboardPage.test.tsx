import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../features/tasks/domain'
import type { TaskRepository } from '../features/tasks/TaskRepository'
import { TaskProvider } from '../features/tasks/TaskProvider'
import type { ReminderRepository } from '../features/reminders/ReminderRepository'
import { ReminderSettingsProvider } from '../features/reminders/ReminderSettingsContext'
import DashboardPage from './DashboardPage'
import TasksPage from './TasksPage'

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: 'Tugas contoh',
    description: '',
    startAt: new Date(now - 60 * 60_000).toISOString(),
    deadlineAt: new Date(now + 60 * 60_000).toISOString(),
    priority: 'medium',
    status: 'active',
    createdAt: new Date(now - 30 * 60_000).toISOString(),
    updatedAt: new Date(now - 30 * 60_000).toISOString(),
    completedAt: null,
    ...overrides,
  }
}

function makeRepository(initial: Task[] = []): TaskRepository {
  let tasks = [...initial]
  return {
    list: async () => [...tasks],
    create: async (task) => {
      tasks = [task, ...tasks]
      return task
    },
    update: async (task) => {
      tasks = tasks.map((current) => (current.id === task.id ? task : current))
      return task
    },
    delete: async (id) => {
      tasks = tasks.filter((task) => task.id !== id)
    },
  }
}

function renderDashboard(tasks: Task[] = []) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TaskProvider repository={makeRepository(tasks)}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
        </Routes>
      </TaskProvider>
    </MemoryRouter>,
  )
}

describe('DashboardPage', () => {
  it('keeps the add-task action available alongside active and completed tasks', async () => {
    renderDashboard([
      makeTask({ title: 'Masih berjalan' }),
      makeTask({
        title: 'Sudah selesai',
        status: 'completed',
        completedAt: new Date().toISOString(),
      }),
    ])

    fireEvent.click(await screen.findByRole('button', { name: 'Tambah tugas' }))
    fireEvent.change(
      screen.getByPlaceholderText('Contoh: Menyusun laporan mingguan'),
      { target: { value: 'Tugas tambahan' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))

    expect(await screen.findAllByText('Tugas tambahan')).toHaveLength(2)
    expect(screen.getByText('Masih berjalan')).toBeTruthy()
    expect(
      screen.getByRole('link', {
        name: 'Buka daftar tugas selesai hari ini (1)',
      }),
    ).toBeTruthy()
  })

  it('persists the selected reminder for the new task without replacing existing tasks', async () => {
    const active = makeTask({ title: 'Tugas yang tetap aktif' })
    const completed = makeTask({
      title: 'Tugas yang sudah selesai',
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    const taskRepository = makeRepository([active, completed])
    const saveReminder = vi.fn(
      async (taskId: string, minutesBefore: number, enabled: boolean) => ({
        id: 'reminder-created',
        taskId,
        minutesBefore,
        enabled,
        createdAt: new Date().toISOString(),
      }),
    )
    const reminderRepository: ReminderRepository = {
      list: async () => [],
      saveReminder,
      removeReminder: async () => {},
      savePushSubscription: async () => {},
      removePushSubscription: async () => {},
      getNotificationSoundPreference: async () => null,
      saveNotificationSoundPreference: async () => {},
      uploadNotificationSound: async () => 'user-a/sound.mp3',
      getNotificationSoundUrl: async () => 'https://storage.example/sound',
      removeNotificationSound: async () => {},
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <TaskProvider repository={taskRepository}>
          <ReminderSettingsProvider repository={reminderRepository}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
            </Routes>
          </ReminderSettingsProvider>
        </TaskProvider>
      </MemoryRouter>,
    )

    await screen.findByText(/Browser ini tidak mendukung push/)
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah tugas' }))
    fireEvent.change(
      screen.getByPlaceholderText('Contoh: Menyusun laporan mingguan'),
      { target: { value: 'Pengingat baru' } },
    )
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Aktifkan pengingat untuk tugas ini',
      }),
    )
    fireEvent.change(screen.getByLabelText('Durasi pengingat dalam menit'), {
      target: { value: '45' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))

    await waitFor(() => expect(saveReminder).toHaveBeenCalledOnce())
    expect(saveReminder.mock.calls[0][1]).toBe(45)
    const persistedTasks = await taskRepository.list()
    expect(persistedTasks.map((task) => task.id)).toEqual(
      expect.arrayContaining([active.id, completed.id]),
    )
    expect(persistedTasks).toHaveLength(3)
  })

  it('opens the task dialog from the empty state and reflects a created task', async () => {
    renderDashboard()

    expect(
      await screen.findByText('Belum ada tugas yang menunggu'),
    ).toBeTruthy()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Buat tugas baru' })[0],
    )
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Belum ada tugas yang menunggu')).toBeTruthy()

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Buat tugas baru' })[0],
    )
    fireEvent.change(
      screen.getByPlaceholderText('Contoh: Menyusun laporan mingguan'),
      { target: { value: 'Rencana baru' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))

    await waitFor(() =>
      expect(
        document.getElementById('companion-heading')?.textContent,
      ).toContain('Rencana baru'),
    )
    expect(
      document.querySelector('.hero-companion[data-expression="calm"]'),
    ).toBeTruthy()
  })

  it('shows a happy Momo when every task is completed and there are no active tasks', async () => {
    const completedAt = new Date().toISOString()
    renderDashboard([
      makeTask({
        status: 'completed',
        deadlineAt: new Date(Date.now() - 1_000).toISOString(),
        completedAt,
      }),
    ])

    expect(
      await screen.findByRole('heading', { name: /Semua langkahmu/ }),
    ).toBeTruthy()
    expect(
      document.querySelector('.hero-companion[data-expression="happy"]'),
    ).toBeTruthy()
    expect(screen.getByText('Semua tugas sudah selesai')).toBeTruthy()
  })

  it('distinguishes cancelled history from an account with no tasks', async () => {
    renderDashboard([makeTask({ status: 'cancelled' })])

    expect(await screen.findByText('Belum ada tugas aktif')).toBeTruthy()
    expect(screen.queryByText('Belum ada tugas yang menunggu')).toBeNull()
    expect(
      document.querySelector('.hero-companion[data-expression="calm"]'),
    ).toBeTruthy()
  })

  it('opens the task page filtered to items that need attention', async () => {
    const now = Date.now()
    const activeTask = makeTask({
      title: 'Butuh perhatian',
      startAt: new Date(now - 50 * 60_000).toISOString(),
      deadlineAt: new Date(now + 10 * 60_000).toISOString(),
    })
    const completedTask = makeTask({
      title: 'Tuntas hari ini',
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    renderDashboard([activeTask, completedTask])

    fireEvent.click(
      screen.getByRole('link', { name: /tugas yang perlu perhatian/i }),
    )

    expect(
      await screen.findByRole('heading', { name: 'Tugas saya' }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: /Perlu perhatian/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', {
        name: 'Buka rincian tugas Butuh perhatian',
      }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', {
        name: 'Buka rincian tugas Tuntas hari ini',
      }),
    ).toBeNull()
  })

  it('opens the task page filtered to tasks completed today', async () => {
    const completedTask = makeTask({
      title: 'Tuntas hari ini',
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    renderDashboard([completedTask])

    fireEvent.click(
      screen.getByRole('link', { name: /daftar tugas selesai hari ini/ }),
    )

    expect(
      await screen.findByRole('heading', { name: 'Tugas saya' }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: /Selesai hari ini/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', {
        name: 'Buka rincian tugas Tuntas hari ini',
      }),
    ).toBeTruthy()
  })
})
