import { describe, expect, it, vi } from 'vitest'
import type { Task } from './domain'
import { migrateLocalTasks, migrateLocalTasksOnce } from './migrateLocalTasks'

const localTask: Task = {
  id: 'local-1',
  title: 'Catatan lokal',
  description: '',
  startAt: '2026-10-22T00:00:00.000Z',
  deadlineAt: '2026-10-23T00:00:00.000Z',
  priority: 'medium',
  status: 'active',
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
  completedAt: null,
}

function migrationStores(initialRemote: Task[] = []) {
  let localTasks = [localTask]
  let remoteTasks = [...initialRemote]
  const imported: Task[][] = []
  const local = {
    list: async () => [...localTasks],
    clearAfterVerifiedMigration: async (expected: Task[]) => {
      if (JSON.stringify(localTasks) !== JSON.stringify(expected)) {
        throw new Error('local changed')
      }
      localTasks = []
    },
  }
  const remote = {
    list: async () => [...remoteTasks],
    importTasks: async (tasks: Task[]) => {
      imported.push(tasks)
      remoteTasks = [...remoteTasks, ...tasks]
    },
  }
  return {
    local,
    remote,
    imported,
    localTasks: () => localTasks,
    remoteTasks: () => remoteTasks,
  }
}

describe('local task account migration', () => {
  it('uploads, verifies remote records, and only then clears local data', async () => {
    const stores = migrationStores()
    expect(await migrateLocalTasks(stores.local, stores.remote)).toBe(1)
    expect(stores.imported).toEqual([[localTask]])
    expect(stores.remoteTasks()).toEqual([localTask])
    expect(stores.localTasks()).toEqual([])
  })

  it('preserves local tasks when upload fails', async () => {
    const stores = migrationStores()
    stores.remote.importTasks = async () => {
      throw new Error('offline')
    }
    await expect(
      migrateLocalTasks(stores.local, stores.remote),
    ).rejects.toThrow('offline')
    expect(stores.localTasks()).toEqual([localTask])
  })

  it('preserves local tasks when an upload cannot be read back for verification', async () => {
    const stores = migrationStores()
    stores.remote.importTasks = async () => {}
    await expect(
      migrateLocalTasks(stores.local, stores.remote),
    ).rejects.toThrow('Verifikasi salinan akun belum lengkap')
    expect(stores.localTasks()).toEqual([localTask])
  })

  it('preserves local tasks when the same ID has conflicting remote content', async () => {
    const stores = migrationStores([{ ...localTask, title: 'Versi akun' }])
    await expect(
      migrateLocalTasks(stores.local, stores.remote),
    ).rejects.toThrow('ID sama tetapi isi berbeda')
    expect(stores.localTasks()).toEqual([localTask])
    expect(stores.imported).toHaveLength(0)
  })

  it('coalesces repeated migration effects for a user during one app session', async () => {
    const stores = migrationStores()
    const importSpy = vi.spyOn(stores.remote, 'importTasks')
    const first = migrateLocalTasksOnce(
      'strict-mode-user',
      stores.local,
      stores.remote,
    )
    const second = migrateLocalTasksOnce(
      'strict-mode-user',
      stores.local,
      stores.remote,
    )
    expect(second).toBe(first)
    await first
    expect(importSpy).toHaveBeenCalledOnce()
  })
})
