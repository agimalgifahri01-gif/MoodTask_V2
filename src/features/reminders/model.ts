import { getCharacterMessage } from '../character/messages.ts'
import {
  getTaskMood,
  taskMoodLabels,
  type Task,
  type TaskMood,
} from '../tasks/domain.ts'

export const MAX_REMINDER_MINUTES = 365 * 24 * 60

export type TaskReminder = {
  id: string
  taskId: string
  minutesBefore: number
  enabled: boolean
  createdAt: string
}

export type ReminderDurationInput = {
  days: string
  hours: string
  minutes: string
}

export type PushSubscriptionData = {
  endpoint: string
  expirationTime: number | null
  keys: { p256dh: string; auth: string }
}

export type DueTaskReminder = {
  task: Task
  reminder: TaskReminder
  scheduledAt: number
  mood: TaskMood
}

export class ReminderValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReminderValidationError'
  }
}

export function getReminderDurationMinutes(
  duration: ReminderDurationInput,
): number | null {
  const values = [duration.days, duration.hours, duration.minutes]
  if (values.every((value) => value.trim() === '')) return null
  if (
    values.some((value) => value.trim() !== '' && !/^\d+$/.test(value.trim()))
  ) {
    throw new ReminderValidationError(
      'Durasi pengingat harus berupa bilangan bulat nol atau lebih.',
    )
  }
  const parsed = values.map((value) =>
    value.trim() === '' ? 0 : Number(value),
  )
  if (parsed.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new ReminderValidationError(
      'Durasi pengingat harus berupa bilangan bulat nol atau lebih.',
    )
  }
  const [days, hours, minutes] = parsed
  const total = days * 1_440 + hours * 60 + minutes
  if (total <= 0) {
    throw new ReminderValidationError(
      'Isi durasi pengingat lebih dari nol atau pilih tanpa pengingat.',
    )
  }
  if (total > MAX_REMINDER_MINUTES) {
    throw new ReminderValidationError(
      'Durasi pengingat maksimal 365 hari sebelum deadline.',
    )
  }
  return total
}

export function validateNewReminderSchedule(
  startAtValue: string,
  deadlineAtValue: string,
  minutesBefore: number,
  now: number,
) {
  validateReminderRange(startAtValue, deadlineAtValue, minutesBefore)
  if (!Number.isFinite(now)) {
    throw new ReminderValidationError('Waktu saat ini tidak valid.')
  }
  if (Date.parse(deadlineAtValue) - minutesBefore * 60_000 <= now) {
    throw new ReminderValidationError(
      'Waktu pengingat sudah lewat. Pilih waktu yang masih akan datang atau matikan pengingat.',
    )
  }
}

function validateReminderRange(
  startAtValue: string,
  deadlineAtValue: string,
  minutesBefore: number,
) {
  if (
    !Number.isInteger(minutesBefore) ||
    minutesBefore < 1 ||
    minutesBefore > MAX_REMINDER_MINUTES
  ) {
    throw new ReminderValidationError(
      'Waktu pengingat harus antara 1 menit dan 365 hari sebelum deadline.',
    )
  }
  const startAt = Date.parse(startAtValue)
  const deadlineAt = Date.parse(deadlineAtValue)
  if (
    !Number.isFinite(startAt) ||
    !Number.isFinite(deadlineAt) ||
    deadlineAt <= startAt
  ) {
    throw new ReminderValidationError('Rentang waktu tugas tidak valid.')
  }
  if (minutesBefore * 60_000 >= deadlineAt - startAt) {
    throw new ReminderValidationError(
      'Pengingat harus jatuh setelah waktu mulai tugas.',
    )
  }
}

export function validateReminderOffset(task: Task, minutesBefore: number) {
  validateReminderRange(task.startAt, task.deadlineAt, minutesBefore)
}

/** Recomputes due times from each task's current deadline, never a saved mood. */
export function getDueTaskReminders(
  tasks: Task[],
  reminders: TaskReminder[],
  now: number,
): DueTaskReminder[] {
  if (!Number.isFinite(now)) return []
  const activeTasks = new Map(
    tasks
      .filter((task) => task.status === 'active')
      .map((task) => [task.id, task]),
  )
  const byTask = new Map<string, TaskReminder[]>()
  for (const reminder of reminders) {
    if (!reminder.enabled) continue
    const task = activeTasks.get(reminder.taskId)
    if (!task) continue
    try {
      validateReminderOffset(task, reminder.minutesBefore)
    } catch {
      continue
    }
    const current = byTask.get(task.id) ?? []
    current.push(reminder)
    byTask.set(task.id, current)
  }

  const due: DueTaskReminder[] = []
  for (const [taskId, taskReminders] of byTask) {
    const task = activeTasks.get(taskId)
    if (!task) continue
    const deadline = Date.parse(task.deadlineAt)
    const overdue = deadline <= now
    const eligible = overdue
      ? taskReminders.reduce<TaskReminder[]>((closest, reminder) => {
          const current = closest[0]
          return !current || reminder.minutesBefore < current.minutesBefore
            ? [reminder]
            : closest
        }, [])
      : taskReminders

    for (const reminder of eligible) {
      const scheduledAt = deadline - reminder.minutesBefore * 60_000
      if (scheduledAt > now) continue
      const mood = getTaskMood(task, now)
      if (mood) due.push({ task, reminder, scheduledAt, mood })
    }
  }
  return due.sort((left, right) => left.scheduledAt - right.scheduledAt)
}

export function createReminderNotification(
  task: Task,
  reminder: TaskReminder,
  now: number,
) {
  const mood = getTaskMood(task, now)
  if (!mood) return null
  const remaining = Date.parse(task.deadlineAt) - now
  const minutes = Math.ceil(Math.abs(remaining) / 60_000)
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const rest = minutes % 60
  const timeParts = [
    days > 0 ? `${days} hari` : '',
    hours > 0 ? `${hours} jam` : '',
    days === 0 && rest > 0 ? `${rest} menit` : '',
  ].filter(Boolean)
  const timeText = timeParts.slice(0, 2).join(' ') || 'kurang dari 1 menit'
  const deadlineText =
    remaining <= 0 ? `Deadline terlewat ${timeText}` : `Sisa ${timeText}`

  return {
    mood,
    title: `Momo · ${taskMoodLabels[mood]}`,
    body: `${task.title} · ${deadlineText}. ${getCharacterMessage(mood, task.id)}`,
    icon: `/momo/${mood}.svg`,
    tag: `moodtask-${task.id}-${reminder.id}-${Date.parse(task.deadlineAt)}`,
    taskId: task.id,
  }
}

export function formatReminderOffset(minutes: number) {
  const parts: string[] = []
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const remainingMinutes = minutes % 60
  if (days) parts.push(`${days} hari`)
  if (hours) parts.push(`${hours} jam`)
  if (remainingMinutes) parts.push(`${remainingMinutes} menit`)
  return parts.join(' ') || '0 menit'
}
