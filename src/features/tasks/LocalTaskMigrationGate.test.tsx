import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from './domain'
import type { TaskMigrationSource, TaskMigrationTarget } from './TaskRepository'
import LocalTaskMigrationGate from './LocalTaskMigrationGate'

const localTask: Task = {
  id: 'local-task-1',
  title: 'Local task',
  description: 'Private local note',
  startAt: '2026-10-22T00:00:00.000Z',
  deadlineAt: '2026-10-23T00:00:00.000Z',
  priority: 'medium',
  status: 'active',
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
  completedAt: null,
}

function makeStores() {
  let localRows = [{ ...localTask }]
  const remoteRows: Task[] = []
  let failAfterRemoteWrite = false
  let failLocalRead = false
  const local = {
    list: vi.fn(async () => {
      if (failLocalRead) throw new Error('local storage unavailable')
      return localRows.map((task) => ({ ...task }))
    }),
    clearAfterVerifiedMigration: vi.fn(async (expected: Task[]) => {
      if (JSON.stringify(localRows) !== JSON.stringify(expected)) {
        throw new Error('local changed')
      }
      localRows = []
    }),
  }
  const remote = {
    list: vi.fn(async () => remoteRows.map((task) => ({ ...task }))),
    importTasks: vi.fn(async (tasks: Task[]) => {
      const knownIds = new Set(remoteRows.map((task) => task.id))
      remoteRows.push(...tasks.filter((task) => !knownIds.has(task.id)))
      if (failAfterRemoteWrite) {
        failAfterRemoteWrite = false
        throw new Error('simulated network interruption')
      }
    }),
  }
  return {
    local: local as TaskMigrationSource,
    remote: remote as TaskMigrationTarget,
    localMock: local,
    remoteMock: remote,
    localRows: () => localRows.map((task) => ({ ...task })),
    remoteRows: () => remoteRows.map((task) => ({ ...task })),
    addLocalTask: () => {
      localRows = [...localRows, { ...localTask, id: 'local-task-2' }]
    },
    failAfterRemoteWrite: () => {
      failAfterRemoteWrite = true
    },
    failLocalRead: () => {
      failLocalRead = true
    },
  }
}

function renderGate(stores: ReturnType<typeof makeStores>) {
  return render(
    <LocalTaskMigrationGate
      userId="test-user"
      local={stores.local}
      remote={stores.remote}
    >
      {(result) => (
        <div data-testid="ready-state">
          {`${result.migrated}:${result.localCount}:${result.localRetained}`}
        </div>
      )}
    </LocalTaskMigrationGate>,
  )
}

describe('local task migration consent gate', () => {
  it('shows the local source and count before any remote read or local clear', async () => {
    const stores = makeStores()
    renderGate(stores)

    expect(
      await screen.findByRole('heading', { name: 'Tugas lokal ditemukan' }),
    ).toBeTruthy()
    expect(screen.getByRole('main').textContent).toContain(
      'Ada 1 tugas di penyimpanan browser perangkat ini',
    )
    expect(stores.remoteMock.list).not.toHaveBeenCalled()
    expect(stores.localMock.clearAfterVerifiedMigration).not.toHaveBeenCalled()
  })

  it('keeps local tasks and does not contact the remote repository when declined', async () => {
    const stores = makeStores()
    renderGate(stores)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Lanjut tanpa memindahkan' }),
    )

    expect(screen.getByTestId('ready-state').textContent).toBe('0:1:true')
    expect(stores.localRows()).toEqual([localTask])
    expect(stores.remoteMock.list).not.toHaveBeenCalled()
    expect(stores.remoteMock.importTasks).not.toHaveBeenCalled()
  })

  it('warns that local data may remain when its count cannot be read', async () => {
    const stores = makeStores()
    stores.failLocalRead()
    renderGate(stores)

    expect(await screen.findByText('Sinkronisasi belum siap')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Lanjut tanpa memindahkan' }),
    )

    expect(screen.getByTestId('ready-state').textContent).toBe('0:null:true')
    expect(stores.remoteMock.list).not.toHaveBeenCalled()
    expect(stores.remoteMock.importTasks).not.toHaveBeenCalled()
  })

  it('clears local data only after an explicitly approved migration verifies', async () => {
    const stores = makeStores()
    renderGate(stores)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Pindahkan 1 tugas ke akun ini',
      }),
    )

    await waitFor(() =>
      expect(screen.getByTestId('ready-state').textContent).toBe('1:1:false'),
    )
    expect(stores.remoteRows()).toEqual([localTask])
    expect(stores.localRows()).toEqual([])
  })

  it('retains local tasks after a failed upload and allows a safe decline', async () => {
    const stores = makeStores()
    stores.failAfterRemoteWrite()
    renderGate(stores)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Pindahkan 1 tugas ke akun ini',
      }),
    )
    expect(await screen.findByText('Sinkronisasi belum siap')).toBeTruthy()
    expect(stores.localRows()).toEqual([localTask])
    fireEvent.click(
      screen.getByRole('button', { name: 'Lanjut tanpa memindahkan' }),
    )
    expect(screen.getByTestId('ready-state').textContent).toBe('0:1:true')
    expect(stores.localRows()).toEqual([localTask])
  })

  it('does not upload new local tasks that appeared after consent was shown', async () => {
    const stores = makeStores()
    renderGate(stores)
    const approval = await screen.findByRole('button', {
      name: 'Pindahkan 1 tugas ke akun ini',
    })
    stores.addLocalTask()
    fireEvent.click(approval)

    expect(
      await screen.findByRole('button', {
        name: 'Pindahkan 2 tugas ke akun ini',
      }),
    ).toBeTruthy()
    expect(stores.remoteMock.list).not.toHaveBeenCalled()
    expect(stores.localRows()).toHaveLength(2)
  })

  it('retries a partial upload without duplicating already copied task IDs', async () => {
    const stores = makeStores()
    stores.failAfterRemoteWrite()
    renderGate(stores)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Pindahkan 1 tugas ke akun ini',
      }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Coba pindahkan lagi' }),
    )

    await waitFor(() =>
      expect(screen.getByTestId('ready-state').textContent).toBe('0:1:false'),
    )
    expect(stores.remoteRows()).toEqual([localTask])
    expect(stores.remoteMock.importTasks).toHaveBeenCalledOnce()
    expect(stores.localRows()).toEqual([])
  })
})
