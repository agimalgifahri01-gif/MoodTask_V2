import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { LocalStorageTaskRepository } from './LocalStorageTaskRepository'
import { useTasks } from './TaskContext'
import { TaskProvider } from './TaskProvider'

function TaskHarness() {
  const { tasks, loading, createTask, updateTask, setStatus, deleteTask } =
    useTasks()
  const [error, setError] = useState('')
  const draft = {
    title: 'Tugas persist',
    description: 'Catatan tersimpan',
    startAt: '2026-10-22T00:00:00.000Z',
    deadlineAt: '2026-10-23T00:00:00.000Z',
    priority: 'medium' as const,
  }

  return (
    <div>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="tasks">{JSON.stringify(tasks)}</output>
      <output data-testid="error">{error}</output>
      <button
        onClick={async () => {
          try {
            await createTask(draft)
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'error')
          }
        }}
      >
        create
      </button>
      <button
        onClick={() =>
          updateTask(tasks[0].id, { ...draft, title: 'Tugas diperbarui' })
        }
      >
        update
      </button>
      <button onClick={() => setStatus(tasks[0].id, 'completed')}>
        complete
      </button>
      <button onClick={() => setStatus(tasks[0].id, 'cancelled')}>
        cancel
      </button>
      <button onClick={() => setStatus(tasks[0].id, 'active')}>
        reactivate
      </button>
      <button onClick={() => deleteTask(tasks[0].id)}>delete</button>
    </div>
  )
}

function renderProvider(repository?: LocalStorageTaskRepository) {
  return render(
    <TaskProvider repository={repository}>
      <TaskHarness />
    </TaskProvider>,
  )
}

function readTasks() {
  return JSON.parse(screen.getByTestId('tasks').textContent ?? '[]') as Array<{
    id: string
    title: string
    status: string
    completedAt: string | null
  }>
}

describe('TaskProvider persistence integration', () => {
  it('restores after remount and persists CRUD and status transitions', async () => {
    let mount = renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'create' }))
    await waitFor(() => expect(readTasks()).toHaveLength(1))
    mount.unmount()

    mount = renderProvider()
    await waitFor(() => expect(readTasks()[0]?.title).toBe('Tugas persist'))

    fireEvent.click(screen.getByRole('button', { name: 'update' }))
    await waitFor(() => expect(readTasks()[0]?.title).toBe('Tugas diperbarui'))
    fireEvent.click(screen.getByRole('button', { name: 'complete' }))
    await waitFor(() => {
      expect(readTasks()[0]).toMatchObject({
        status: 'completed',
      })
      expect(readTasks()[0].completedAt).toBeTruthy()
    })
    mount.unmount()

    mount = renderProvider()
    await waitFor(() => expect(readTasks()[0]?.status).toBe('completed'))
    fireEvent.click(screen.getByRole('button', { name: 'reactivate' }))
    await waitFor(() =>
      expect(readTasks()[0]).toMatchObject({
        status: 'active',
        completedAt: null,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    await waitFor(() => expect(readTasks()[0]?.status).toBe('cancelled'))
    mount.unmount()

    renderProvider()
    await waitFor(() => expect(readTasks()[0]?.status).toBe('cancelled'))
    fireEvent.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(readTasks()).toHaveLength(0))
  })

  it('does not publish a new task when browser persistence fails', async () => {
    const repository = new LocalStorageTaskRepository({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    })
    renderProvider(repository)
    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'create' }))
    await waitFor(() => {
      expect(readTasks()).toEqual([])
      expect(screen.getByTestId('error').textContent).toContain(
        'Perubahan tidak tersimpan',
      )
    })
  })
})
