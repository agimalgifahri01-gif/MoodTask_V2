export type TaskStatus = 'active' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskMood = 'calm' | 'alert' | 'anxious' | 'panic' | 'late' | 'happy'

export type Task = {
  id: string
  title: string
  description: string
  startAt: string
  deadlineAt: string
  priority: TaskPriority
  status: TaskStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type TaskDraft = Omit<
  Task,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt'
>

export type DeadlineState = {
  remainingPercentage: number
  rawRemainingPercentage: number
  remainingMilliseconds: number
  isOverdue: boolean
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskValidationError'
  }
}

function toTimestamp(value: string, label: string): number {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TaskValidationError(`${label} wajib diisi.`)
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new TaskValidationError(`${label} tidak valid.`)
  }

  return timestamp
}

export function validateTaskDraft(draft: TaskDraft): TaskDraft {
  if (typeof draft !== 'object' || draft === null) {
    throw new TaskValidationError('Data tugas tidak valid.')
  }
  if (typeof draft.title !== 'string') {
    throw new TaskValidationError('Judul tugas wajib diisi.')
  }
  const title = draft.title.trim()
  if (!title) throw new TaskValidationError('Judul tugas wajib diisi.')
  if (title.length > 120) {
    throw new TaskValidationError('Judul maksimal 120 karakter.')
  }
  if (typeof draft.description !== 'string') {
    throw new TaskValidationError('Catatan tugas tidak valid.')
  }
  if (draft.description.trim().length > 2000) {
    throw new TaskValidationError('Deskripsi maksimal 2.000 karakter.')
  }

  const start = toTimestamp(draft.startAt, 'Waktu mulai')
  const deadline = toTimestamp(draft.deadlineAt, 'Deadline')
  if (deadline <= start) {
    throw new TaskValidationError('Deadline harus setelah waktu mulai.')
  }
  if (!['low', 'medium', 'high'].includes(draft.priority)) {
    throw new TaskValidationError('Prioritas tugas tidak valid.')
  }

  return { ...draft, title, description: draft.description.trim() }
}

export function calculateDeadlineState(
  startAt: string,
  deadlineAt: string,
  now: number,
): DeadlineState {
  const start = toTimestamp(startAt, 'Waktu mulai')
  const deadline = toTimestamp(deadlineAt, 'Deadline')
  if (deadline <= start) {
    throw new TaskValidationError('Deadline harus setelah waktu mulai.')
  }
  if (!Number.isFinite(now)) {
    throw new TaskValidationError('Waktu saat ini tidak valid.')
  }

  const remainingMilliseconds = deadline - now
  const rawRemainingPercentage =
    (remainingMilliseconds / (deadline - start)) * 100

  return {
    remainingPercentage: Math.min(100, Math.max(0, rawRemainingPercentage)),
    rawRemainingPercentage,
    remainingMilliseconds,
    isOverdue: remainingMilliseconds <= 0,
  }
}

export function getTaskMood(task: Task, now: number): TaskMood | null {
  if (task.status === 'completed') return 'happy'
  if (task.status === 'cancelled') return null

  const { rawRemainingPercentage, isOverdue } = calculateDeadlineState(
    task.startAt,
    task.deadlineAt,
    now,
  )
  if (isOverdue || rawRemainingPercentage <= 0) return 'late'
  if (rawRemainingPercentage <= 25) return 'panic'
  if (rawRemainingPercentage <= 50) return 'anxious'
  if (rawRemainingPercentage <= 75) return 'alert'
  return 'calm'
}

export const taskMoodLabels: Record<TaskMood, string> = {
  calm: 'Santai',
  alert: 'Waspada',
  anxious: 'Cemas',
  panic: 'Panik',
  late: 'Terlambat',
  happy: 'Bahagia',
}

export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
}

export const taskStatusLabels: Record<TaskStatus, string> = {
  active: 'Aktif',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}
