import type { Task } from './domain'
import type { TaskMigrationSource, TaskMigrationTarget } from './TaskRepository'

function sameTask(left: Task, right: Task): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.description === right.description &&
    left.startAt === right.startAt &&
    left.deadlineAt === right.deadlineAt &&
    left.priority === right.priority &&
    left.status === right.status &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.completedAt === right.completedAt
  )
}

function sameTaskSet(left: Task[], right: readonly Task[]): boolean {
  if (left.length !== right.length) return false
  const expected = new Map(right.map((task) => [task.id, task]))
  if (expected.size !== left.length) return false
  const seen = new Set<string>()
  return left.every((task) => {
    if (seen.has(task.id)) return false
    seen.add(task.id)
    const approved = expected.get(task.id)
    return approved !== undefined && sameTask(task, approved)
  })
}

export class LocalTasksChangedDuringMigrationError extends Error {
  constructor() {
    super(
      'Daftar tugas lokal berubah setelah persetujuan. Tugas belum dipindahkan; tinjau jumlah terbaru sebelum mencoba lagi.',
    )
    this.name = 'LocalTasksChangedDuringMigrationError'
  }
}

/** Preserve local records unless every record has been saved and verified remotely. */
export async function migrateLocalTasks(
  local: TaskMigrationSource,
  remote: TaskMigrationTarget,
  approvedTasks?: readonly Task[],
): Promise<number> {
  const localTasks = await local.list()
  if (approvedTasks && !sameTaskSet(localTasks, approvedTasks)) {
    throw new LocalTasksChangedDuringMigrationError()
  }
  if (localTasks.length === 0) return 0

  const remoteTasks = await remote.list()
  const remoteById = new Map(remoteTasks.map((task) => [task.id, task]))
  const missing: Task[] = []

  for (const task of localTasks) {
    const existing = remoteById.get(task.id)
    if (!existing) missing.push(task)
    else if (!sameTask(existing, task)) {
      throw new Error(
        'Ada tugas lokal dan akun dengan ID sama tetapi isi berbeda. Data lokal dipertahankan; perlu ditinjau sebelum menggabungkan.',
      )
    }
  }

  if (missing.length > 0) await remote.importTasks(missing)

  const verifiedTasks = await remote.list()
  const verifiedById = new Map(verifiedTasks.map((task) => [task.id, task]))
  if (
    localTasks.some((task) => {
      const verified = verifiedById.get(task.id)
      return !verified || !sameTask(task, verified)
    })
  ) {
    throw new Error(
      'Verifikasi salinan akun belum lengkap. Tugas lokal tetap disimpan; coba lagi.',
    )
  }

  const currentLocalTasks = await local.list()
  if (!sameTaskSet(currentLocalTasks, localTasks)) {
    throw new LocalTasksChangedDuringMigrationError()
  }
  await local.clearAfterVerifiedMigration(localTasks)
  return missing.length
}

const migrationsInFlight = new Map<string, Promise<number>>()

export function migrateLocalTasksOnce(
  userId: string,
  local: TaskMigrationSource,
  remote: TaskMigrationTarget,
  approvedTasks?: readonly Task[],
): Promise<number> {
  const pending = migrationsInFlight.get(userId)
  if (pending) return pending
  const migration = migrateLocalTasks(local, remote, approvedTasks).finally(
    () => {
      migrationsInFlight.delete(userId)
    },
  )
  migrationsInFlight.set(userId, migration)
  return migration
}
