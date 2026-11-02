import { ArrowUpRight, CalendarClock, Check, Clock3 } from 'lucide-react'
import { getCompanionExpression } from '../character/moodAdapter'
import {
  calculateDeadlineState,
  getTaskMood,
  taskMoodLabels,
  taskPriorityLabels,
  taskStatusLabels,
  type Task,
  type TaskStatus,
} from './domain'
import { formatDeadlineTime, formatTaskDate } from './presentation'
import Companion from '../../components/Companion'

type Props = {
  task: Task
  now: number
  onOpen: (task: Task) => void
  onStatusChange: (task: Task, status: TaskStatus) => void
  busy?: boolean
}

export default function TaskCard({
  task,
  now,
  onOpen,
  onStatusChange,
  busy = false,
}: Props) {
  const mood = getTaskMood(task, now)
  const deadline =
    task.status === 'active'
      ? calculateDeadlineState(task.startAt, task.deadlineAt, now)
      : null

  return (
    <article
      className={`task-card${task.status !== 'active' ? ' task-card-inactive' : ''}${mood === 'late' || mood === 'panic' ? ' task-card-attention' : ''}`}
    >
      <button
        type="button"
        className="task-card-title"
        onClick={() => onOpen(task)}
        aria-label={`Buka rincian tugas ${task.title}`}
      >
        <span>{task.title}</span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>
      {task.description && (
        <p className="task-card-description">{task.description}</p>
      )}

      <div className="task-card-mood-row">
        {mood && (
          <span className={`task-mood-pill mood-${mood}`}>
            <Companion
              expression={getCompanionExpression(mood)}
              className="task-mood-character"
              label=""
            />
            {taskMoodLabels[mood]}
          </span>
        )}
        {deadline && (
          <span
            className={`task-deadline-copy${deadline.isOverdue ? ' overdue' : ''}`}
          >
            <Clock3 size={13} aria-hidden="true" />
            {deadline.remainingMilliseconds <= 0
              ? `Terlambat ${formatDeadlineTime(deadline.remainingMilliseconds)}`
              : `${formatDeadlineTime(deadline.remainingMilliseconds)} lagi`}
            {` · ${Math.round(deadline.remainingPercentage)}%`}
          </span>
        )}
        {!deadline && task.status === 'completed' && task.completedAt && (
          <span className="task-deadline-copy">
            <Check size={13} aria-hidden="true" /> Selesai{' '}
            {formatTaskDate(task.completedAt)}
          </span>
        )}
        {!deadline && task.status === 'cancelled' && (
          <span className="task-deadline-copy">
            <CalendarClock size={13} aria-hidden="true" /> Tidak aktif
          </span>
        )}
      </div>

      <div className="task-card-topline">
        <span className={`task-status-badge status-${task.status}`}>
          <span className="status-dot" /> {taskStatusLabels[task.status]}
        </span>
        <span className={`priority-badge priority-${task.priority}`}>
          {taskPriorityLabels[task.priority]}
        </span>
      </div>

      <div className="task-card-footer">
        <span>
          <CalendarClock size={13} /> Deadline {formatTaskDate(task.deadlineAt)}
        </span>
        {task.status === 'active' && (
          <button
            type="button"
            className="task-complete-button"
            disabled={busy}
            onClick={() => onStatusChange(task, 'completed')}
          >
            <Check size={14} /> {busy ? 'Menyimpan…' : 'Selesai'}
          </button>
        )}
      </div>
    </article>
  )
}
