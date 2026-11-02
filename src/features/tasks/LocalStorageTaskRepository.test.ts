import { describe, expect, it } from 'vitest'
import type { Task } from './domain'
import {
  decodeStoredTasks,
  LocalStorageTaskRepository,
} from './LocalStorageTaskRepository'

const task: Task = {
  id: 'task-1',
  title: 'Rangkuman materi',
  description: 'Bab dua',
  startAt: '2026-10-22T00:00:00.000Z',
  deadlineAt: '2026-10-23T00:00:00.000Z',
  priority: 'high',
  status: 'active',
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
  completedAt: null,
}

function createStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
    read: () => value,
  }
}

describe('LocalStorageTaskRepository', () => {
  it('saves versioned records without derived deadline or mood values', () => {
    const storage = createStorage()
    const repository = new LocalStorageTaskRepository(storage)
    repository.save([task])

    const raw = storage.read()!
    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1, tasks: [task] })
    expect(raw).not.toContain('remainingPercentage')
    expect(raw).not.toContain('mood')
    expect(repository.load()).toEqual({ tasks: [task], warning: null })
  })

  it('reads valid legacy array data for migration on the next save', () => {
    expect(decodeStoredTasks(JSON.stringify([task]))).toEqual([task])
    const storage = createStorage(JSON.stringify([task]))
    const repository = new LocalStorageTaskRepository(storage)
    expect(repository.load()).toEqual({ tasks: [task], warning: null })
    repository.save([task])
    expect(JSON.parse(storage.read()!).schemaVersion).toBe(1)
  })

  it('reads older records with work progress and drops that field on the next save', () => {
    const legacyTask = { ...task, progressPercent: 72 }
    const storage = createStorage(JSON.stringify([legacyTask]))
    const repository = new LocalStorageTaskRepository(storage)

    expect(repository.load()).toEqual({ tasks: [task], warning: null })
    expect(storage.read()).toContain('progressPercent')

    repository.save([task])
    expect(storage.read()).not.toContain('progressPercent')
  })

  it('rejects corrupt or unknown schema data without overwriting the original', () => {
    for (const raw of [
      '{broken',
      JSON.stringify({ schemaVersion: 77, tasks: [] }),
    ]) {
      const storage = createStorage(raw)
      const repository = new LocalStorageTaskRepository(storage)
      const loaded = repository.load()
      expect(loaded.tasks).toEqual([])
      expect(loaded.warning).toBeTruthy()
      expect(() => repository.save([task])).toThrow(loaded.warning!)
      expect(storage.read()).toBe(raw)
    }
  })

  it('rejects invalid and duplicate task records', () => {
    expect(() =>
      decodeStoredTasks(JSON.stringify([{ ...task, deadlineAt: 'bad' }])),
    ).toThrow()
    expect(() => decodeStoredTasks(JSON.stringify([task, task]))).toThrow(
      'ID tugas duplikat ditemukan.',
    )
  })

  it('surfaces storage read and write failures without claiming a save', () => {
    const readFailure = new LocalStorageTaskRepository({
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {},
      removeItem: () => {},
    })
    expect(readFailure.load().warning).toContain('tidak dapat dibaca')
    expect(() => readFailure.save([task])).toThrow('tidak dapat dibaca')

    const writeFailure = new LocalStorageTaskRepository({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    })
    writeFailure.load()
    expect(() => writeFailure.save([task])).toThrow('Perubahan tidak tersimpan')
  })

  it('serializes concurrent local creates so neither task overwrites the other', async () => {
    const storage = createStorage()
    const repository = new LocalStorageTaskRepository(storage)
    const secondTask = { ...task, id: 'task-2', title: 'Tugas kedua' }
    await Promise.all([repository.create(task), repository.create(secondTask)])
    await expect(repository.list()).resolves.toHaveLength(2)
  })
})
