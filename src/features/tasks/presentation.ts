import {
  calculateDeadlineState,
  getTaskMood,
  type Task,
  type TaskMood,
  type TaskStatus,
} from './domain'

const moodCopy: Record<TaskMood, string> = {
  calm: 'Masih banyak waktu. Jalani dengan santai.',
  alert: 'Waktu mulai berkurang. Pilih satu langkah berikutnya.',
  anxious: 'Deadline semakin dekat. Pecah tugas jadi bagian kecil.',
  panic: 'Sisa waktunya sedikit. Fokus pada hal yang paling penting.',
  late: 'Deadline sudah lewat. Kamu tetap bisa menentukan langkah selanjutnya.',
  happy: 'Tugas ini selesai. Kerja bagus!',
}

export function getTaskMoodCopy(mood: TaskMood) {
  return moodCopy[mood]
}

export function getActiveTasksByUrgency(tasks: Task[], now: number) {
  return tasks
    .filter((task) => task.status === 'active')
    .sort((left, right) => {
      const leftDeadline = Date.parse(left.deadlineAt)
      const rightDeadline = Date.parse(right.deadlineAt)
      const leftOverdue = leftDeadline <= now
      const rightOverdue = rightDeadline <= now
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1
      return leftDeadline - rightDeadline
    })
}

export function getTasksNeedingAttention(tasks: Task[], now: number) {
  return getActiveTasksByUrgency(tasks, now).filter((task) => {
    const mood = getTaskMood(task, now)
    return (
      mood === 'alert' ||
      mood === 'anxious' ||
      mood === 'panic' ||
      mood === 'late'
    )
  })
}

export function getMostUrgentTask(tasks: Task[], now: number) {
  return getActiveTasksByUrgency(tasks, now)[0]
}

export function formatDeadlineTime(milliseconds: number) {
  const minutes = Math.ceil(Math.abs(milliseconds) / 60_000)
  if (minutes === 0) return 'Kurang dari 1 menit'

  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const remainingMinutes = minutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} hari`)
  if (hours > 0 && parts.length < 2) parts.push(`${hours} jam`)
  if (days === 0 && remainingMinutes > 0 && parts.length < 2) {
    parts.push(`${remainingMinutes} menit`)
  }

  return parts.join(' ')
}

export function getDeadlineDescription(task: Task, now: number) {
  const state = calculateDeadlineState(task.startAt, task.deadlineAt, now)
  if (state.remainingMilliseconds <= 0) {
    return `Terlambat ${formatDeadlineTime(state.remainingMilliseconds)}`
  }
  return `${formatDeadlineTime(state.remainingMilliseconds)} lagi`
}

export function formatTaskDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function getCompletedTodayCount(tasks: Task[], now: number) {
  return getTasksCompletedToday(tasks, now).length
}

export function getTasksCompletedToday(tasks: Task[], now: number) {
  const today = new Date(now)
  return tasks.filter((task) => {
    if (task.status !== 'completed' || !task.completedAt) return false
    const completedAt = new Date(task.completedAt)
    return (
      completedAt.getFullYear() === today.getFullYear() &&
      completedAt.getMonth() === today.getMonth() &&
      completedAt.getDate() === today.getDate()
    )
  })
}

export function getVisibleTasks(
  tasks: Task[],
  query: string,
  status: TaskStatus | 'all' | 'attention' | 'completed-today',
  sort: 'deadline' | 'priority' | 'recent',
  now = Date.now(),
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('id-ID')
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const statusFilteredTasks =
    status === 'attention'
      ? getTasksNeedingAttention(tasks, now)
      : status === 'completed-today'
        ? getTasksCompletedToday(tasks, now)
        : tasks.filter((task) => status === 'all' || task.status === status)

  return statusFilteredTasks
    .filter(
      (task) =>
        !normalizedQuery ||
        `${task.title} ${task.description}`
          .toLocaleLowerCase('id-ID')
          .includes(normalizedQuery),
    )
    .sort((left, right) => {
      if (sort === 'recent') {
        return right.createdAt.localeCompare(left.createdAt)
      }
      if (sort === 'priority') {
        const difference =
          priorityOrder[left.priority] - priorityOrder[right.priority]
        if (difference !== 0) return difference
      }
      return Date.parse(left.deadlineAt) - Date.parse(right.deadlineAt)
    })
}
