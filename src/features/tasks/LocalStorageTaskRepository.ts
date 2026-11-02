import {
  validateTaskDraft,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from './domain'
import type { TaskLoadResult, TaskRepository } from './TaskRepository'

const STORAGE_KEY = 'moodtask.tasks'
const SCHEMA_VERSION = 1

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} tidak valid.`)
  }
  return new Date(Date.parse(value)).toISOString()
}

function decodeTask(value: unknown): Task {
  if (!isRecord(value)) throw new Error('Data tugas bukan objek yang valid.')
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    throw new Error('ID tugas tidak valid.')
  }
  if (!['active', 'completed', 'cancelled'].includes(String(value.status))) {
    throw new Error('Status tugas tidak dikenal.')
  }
  if (!['low', 'medium', 'high'].includes(String(value.priority))) {
    throw new Error('Prioritas tugas tidak dikenal.')
  }

  const startAt = normalizeTimestamp(value.startAt, 'Waktu mulai')
  const deadlineAt = normalizeTimestamp(value.deadlineAt, 'Deadline')
  const draft = validateTaskDraft({
    title: value.title as string,
    description: value.description as string,
    startAt,
    deadlineAt,
    priority: value.priority as TaskPriority,
  })
  const status = value.status as TaskStatus
  const completedAt =
    value.completedAt === null
      ? null
      : normalizeTimestamp(value.completedAt, 'Waktu selesai')

  if (status === 'completed' && completedAt === null) {
    throw new Error('Tugas selesai harus memiliki waktu penyelesaian.')
  }
  if (status !== 'completed' && completedAt !== null) {
    throw new Error(
      'Tugas yang belum selesai tidak boleh memiliki waktu selesai.',
    )
  }

  return {
    ...draft,
    id: value.id,
    status,
    createdAt: normalizeTimestamp(value.createdAt, 'Waktu dibuat'),
    updatedAt: normalizeTimestamp(value.updatedAt, 'Waktu diperbarui'),
    completedAt,
  }
}

function decodeTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) throw new Error('Daftar tugas tidak valid.')
  const tasks = value.map(decodeTask)
  const ids = new Set(tasks.map((task) => task.id))
  if (ids.size !== tasks.length) throw new Error('ID tugas duplikat ditemukan.')
  return tasks
}

/** Accepts the former plain-array format for a safe, in-place v1 migration. */
export function decodeStoredTasks(raw: string): Task[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Data tugas tidak dapat dibaca karena format JSON rusak.')
  }

  if (Array.isArray(value)) return decodeTasks(value)
  if (!isRecord(value))
    throw new Error('Format penyimpanan tugas tidak dikenal.')
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Versi data tugas tidak didukung oleh aplikasi ini.')
  }
  return decodeTasks(value.tasks)
}

export class LocalStorageTaskRepository implements TaskRepository {
  private blockedReason: string | null = null
  private readonly storage?: StoragePort
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(storage?: StoragePort) {
    this.storage = storage
  }

  private getStorage(): StoragePort {
    if (this.storage) return this.storage
    return globalThis.localStorage
  }

  load(): TaskLoadResult {
    this.blockedReason = null
    let raw: string | null
    try {
      raw = this.getStorage().getItem(STORAGE_KEY)
    } catch {
      this.blockedReason =
        'Penyimpanan lokal tidak dapat dibaca. Data tugas tidak diubah.'
      return { tasks: [], warning: this.blockedReason }
    }
    if (raw === null) return { tasks: [], warning: null }

    try {
      return { tasks: decodeStoredTasks(raw), warning: null }
    } catch (caught) {
      this.blockedReason =
        caught instanceof Error
          ? `${caught.message} Data asli dipertahankan; perubahan tugas dinonaktifkan agar tidak tertimpa.`
          : 'Data tugas rusak. Data asli dipertahankan dan perubahan dinonaktifkan.'
      return { tasks: [], warning: this.blockedReason }
    }
  }

  save(tasks: Task[]): void {
    if (this.blockedReason) {
      throw new Error(this.blockedReason)
    }
    const validatedTasks = decodeTasks(tasks)
    const envelope = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      tasks: validatedTasks,
    })
    try {
      this.getStorage().setItem(STORAGE_KEY, envelope)
    } catch {
      throw new Error(
        'Perubahan tidak tersimpan. Penyimpanan browser penuh atau tidak tersedia; coba lagi setelah ruang penyimpanan tersedia.',
      )
    }
  }

  async list(): Promise<Task[]> {
    await this.writeQueue
    return this.readAll()
  }

  private readAll(): Task[] {
    const result = this.load()
    if (result.warning) throw new Error(result.warning)
    return result.tasks
  }

  private enqueue<T>(operation: () => T): Promise<T> {
    const result = this.writeQueue.then(operation)
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  create(task: Task): Promise<Task> {
    return this.enqueue(() => {
      const tasks = this.readAll()
      if (tasks.some((current) => current.id === task.id)) {
        throw new Error('ID tugas sudah digunakan.')
      }
      this.save([task, ...tasks])
      return task
    })
  }

  update(task: Task): Promise<Task> {
    return this.enqueue(() => {
      const tasks = this.readAll()
      if (!tasks.some((current) => current.id === task.id)) {
        throw new Error('Tugas tidak ditemukan.')
      }
      this.save(
        tasks.map((current) => (current.id === task.id ? task : current)),
      )
      return task
    })
  }

  delete(id: string): Promise<void> {
    return this.enqueue(() => {
      const tasks = this.readAll()
      if (!tasks.some((task) => task.id === id)) {
        throw new Error('Tugas tidak ditemukan.')
      }
      this.save(tasks.filter((task) => task.id !== id))
    })
  }

  importTasks(tasks: Task[]): Promise<void> {
    return this.enqueue(() => {
      const existing = this.readAll()
      const byId = new Map(existing.map((task) => [task.id, task]))
      for (const task of tasks) {
        const current = byId.get(task.id)
        if (current && JSON.stringify(current) !== JSON.stringify(task)) {
          throw new Error('Konflik ditemukan pada ID tugas saat migrasi.')
        }
        byId.set(task.id, task)
      }
      this.save([...byId.values()])
    })
  }

  clearAfterVerifiedMigration(expectedTasks: Task[]): Promise<void> {
    return this.enqueue(() => {
      const current = this.readAll()
      if (JSON.stringify(current) !== JSON.stringify(expectedTasks)) {
        throw new Error(
          'Data lokal berubah selama migrasi. Salinan lokal dipertahankan; coba migrasi lagi.',
        )
      }
      try {
        this.getStorage().removeItem(STORAGE_KEY)
      } catch {
        throw new Error(
          'Data server sudah diverifikasi, tetapi salinan lokal belum dapat dibersihkan. Data tetap aman di kedua tempat.',
        )
      }
    })
  }
}

export const localStorageTaskRepository = new LocalStorageTaskRepository()
