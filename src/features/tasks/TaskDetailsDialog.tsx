import { useEffect, useRef } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CircleDot,
  Clock3,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import CharacterPresence from '../character/CharacterPresence'
import { getCharacterMessage } from '../character/messages'
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
import ReminderScheduleEditor from '../reminders/ReminderScheduleEditor'

type Props = {
  task: Task | null
  now: number
  onClose: () => void
  onEdit: (task: Task) => void
  onStatusChange: (task: Task, status: TaskStatus) => void
  onDelete: (task: Task) => void
  busy?: boolean
}

export default function TaskDetailsDialog({
  task,
  now,
  onClose,
  onEdit,
  onStatusChange,
  onDelete,
  busy = false,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (task && !dialog.open) dialog.showModal()
    if (!task && dialog.open) dialog.close()
  }, [task])

  const mood = task ? getTaskMood(task, now) : null
  const deadline = task
    ? calculateDeadlineState(task.startAt, task.deadlineAt, now)
    : null

  return (
    <dialog
      className="task-dialog task-detail-dialog"
      ref={dialogRef}
      aria-labelledby="task-detail-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      {task && (
        <div className="task-detail">
          <div className="dialog-heading">
            <span className="section-kicker" role="heading" aria-level={2}>
              RINCIAN TUGAS
            </span>
            <button
              type="button"
              className="dialog-close"
              onClick={onClose}
              aria-label="Tutup rincian"
            >
              <X size={19} />
            </button>
          </div>
          <h2 id="task-detail-title">{task.title}</h2>
          {task.description ? (
            <p className="detail-description">{task.description}</p>
          ) : (
            <p className="detail-description muted">Belum ada catatan.</p>
          )}

          <div className={`detail-mood mood-${mood ?? 'calm'}`}>
            {mood ? (
              <CharacterPresence
                className="detail-companion"
                mood={mood}
                label={`Karakter MoodTask, ${taskMoodLabels[mood].toLowerCase()}`}
              />
            ) : (
              <div className="detail-cancelled-icon">
                <CircleDot size={23} />
              </div>
            )}
            <div>
              <span className="section-kicker">KONDISI KARAKTER</span>
              <strong>
                {mood ? taskMoodLabels[mood] : 'Tugas dibatalkan'}
              </strong>
              <span>
                {mood
                  ? getCharacterMessage(mood, task?.id)
                  : 'Tugas ini tidak lagi masuk hitungan waktu.'}
              </span>
            </div>
          </div>

          <div className="detail-stat-grid">
            <div className="detail-stat">
              <span>
                <CalendarClock size={15} /> Waktu mulai
              </span>
              <strong>{formatTaskDate(task.startAt)}</strong>
            </div>
            <div className="detail-stat">
              <span>
                <Clock3 size={15} /> Deadline
              </span>
              <strong>{formatTaskDate(task.deadlineAt)}</strong>
            </div>
            <div className="detail-stat">
              <span>
                <CircleDot size={15} /> Status
              </span>
              <strong>{taskStatusLabels[task.status]}</strong>
            </div>
            <div className="detail-stat">
              <span>
                <AlertTriangle size={15} /> Prioritas
              </span>
              <strong>{taskPriorityLabels[task.priority]}</strong>
            </div>
          </div>

          <div className="detail-time-section">
            {deadline && task.status === 'active' && (
              <p className="time-remaining">
                {deadline.remainingMilliseconds <= 0
                  ? `Terlambat ${formatDeadlineTime(deadline.remainingMilliseconds)}`
                  : `${formatDeadlineTime(deadline.remainingMilliseconds)} lagi`}
                <span> · </span>
                {Math.round(deadline.remainingPercentage)}% waktu tersisa
              </p>
            )}
          </div>

          <ReminderScheduleEditor task={task} />

          <div className="dialog-actions detail-actions">
            {task.status === 'active' ? (
              <>
                <button
                  type="button"
                  className="button button-quiet danger-action"
                  disabled={busy}
                  onClick={() => onStatusChange(task, 'cancelled')}
                >
                  Batalkan tugas
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => onStatusChange(task, 'completed')}
                >
                  <Check size={16} /> Selesaikan
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => onStatusChange(task, 'active')}
              >
                <RotateCcw size={15} /> Aktifkan kembali
              </button>
            )}
          </div>
          <div className="detail-secondary-actions">
            <button type="button" onClick={() => onEdit(task)} disabled={busy}>
              <Pencil size={14} /> Ubah tugas
            </button>
            <button
              type="button"
              className="danger-action"
              disabled={busy}
              onClick={() => onDelete(task)}
            >
              <Trash2 size={14} /> Hapus tugas
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
