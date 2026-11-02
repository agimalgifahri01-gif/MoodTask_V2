import { useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Leaf,
  Plus,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import CharacterPresence from '../features/character/CharacterPresence'
import { getCharacterMessage } from '../features/character/messages'
import {
  calculateDeadlineState,
  getTaskMood,
  taskMoodLabels,
  type TaskDraft,
} from '../features/tasks/domain'
import TaskFormDialog from '../features/tasks/TaskFormDialog'
import {
  formatDeadlineTime,
  getActiveTasksByUrgency,
  getCompletedTodayCount,
  getTasksNeedingAttention,
} from '../features/tasks/presentation'
import { useTasks } from '../features/tasks/TaskContext'
import { useCurrentTime } from '../features/tasks/useCurrentTime'
import { useOptionalReminderSettings } from '../features/reminders/ReminderSettingsContext'

function compactTitle(title: string) {
  return title.length > 29 ? `${title.slice(0, 28).trimEnd()}…` : title
}

export default function DashboardPage() {
  const { tasks, createTask } = useTasks()
  const reminderSettings = useOptionalReminderSettings()
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskNotice, setTaskNotice] = useState('')
  const now = useCurrentTime()
  const today = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(new Date(now))
    .toLocaleUpperCase('id-ID')
  const activeTasks = getActiveTasksByUrgency(tasks, now)
  const urgentTask = activeTasks[0]
  const nextTasks = activeTasks.slice(0, 3)
  const attentionCount = getTasksNeedingAttention(tasks, now).length
  const completedToday = getCompletedTodayCount(tasks, now)
  const allTasksCompleted =
    tasks.length > 0 && tasks.every((task) => task.status === 'completed')
  const mood = urgentTask
    ? (getTaskMood(urgentTask, now) ?? 'calm')
    : allTasksCompleted
      ? 'happy'
      : 'calm'
  const moodCopy = getCharacterMessage(mood, urgentTask?.id)
  const deadline = urgentTask
    ? calculateDeadlineState(urgentTask.startAt, urgentTask.deadlineAt, now)
    : null
  async function saveDashboardTask(
    draft: TaskDraft,
    reminderMinutesBefore: number | null,
  ) {
    const task = await createTask(draft)
    let notice = 'Tugas baru berhasil ditambahkan.'
    if (reminderMinutesBefore !== null) {
      try {
        if (!reminderSettings?.repositoryAvailable) {
          throw new Error('Jadwal pengingat memerlukan akun MoodTask.')
        }
        await reminderSettings.saveReminder(task, reminderMinutesBefore, true)
        notice = 'Tugas dan jadwal pengingat berhasil disimpan.'
      } catch {
        notice =
          'Tugas tersimpan, tetapi jadwal pengingat gagal disimpan. Tambahkan pengingat dari rincian tugas.'
      }
    }
    setTaskNotice(notice)
    setTaskFormOpen(false)
  }

  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-spark">✳</span> {today}
          </div>
          <h1>
            Hai, selamat datang <span className="wave">✳</span>
          </h1>
          <p className="welcome-subtitle">
            Hari baru, ruang baru untuk menyelesaikan sesuatu.
          </p>
        </div>
        <div className="welcome-actions">
          <button
            type="button"
            className="button button-primary welcome-add-task"
            onClick={() => setTaskFormOpen(true)}
          >
            <Plus size={16} /> Tambah tugas
          </button>
          <div className="streak-pill">
            <span className="streak-sun">✳</span>
            <span>
              <strong>Ritmemu sendiri</strong>
              <small>Tak perlu terburu-buru</small>
            </span>
          </div>
        </div>
      </section>

      {taskNotice && (
        <div className="task-feedback dashboard-task-notice" role="status">
          <span className="status-dot" /> {taskNotice}
          <button
            type="button"
            onClick={() => setTaskNotice('')}
            aria-label="Tutup pesan"
          >
            Ã—
          </button>
        </div>
      )}

      <section className="hero-card" aria-labelledby="companion-heading">
        <div className="hero-orbit orbit orbit-one" />
        <div className="hero-orbit orbit orbit-two" />
        <div className="hero-copy">
          <div className="hero-label">
            <span className="status-dot" />
            {` TEMAN KECILMU · ${taskMoodLabels[mood].toUpperCase()}`}
          </div>
          <h2 id="companion-heading">
            {urgentTask ? (
              <>
                Kita mulai dari
                <br />
                <em>{compactTitle(urgentTask.title)}</em>
              </>
            ) : allTasksCompleted ? (
              <>
                Semua langkahmu
                <br />
                <em>telah selesai.</em>
              </>
            ) : (
              <>
                {tasks.length > 0 ? 'Belum ada tugas' : 'Semua berawal'}
                <br />
                {tasks.length > 0 ? (
                  <em>aktif yang menunggu.</em>
                ) : (
                  <>
                    dari <em>satu langkah.</em>
                  </>
                )}
              </>
            )}
          </h2>
          <p>
            {urgentTask
              ? moodCopy
              : allTasksCompleted
                ? 'Semua tugasmu telah selesai. Momo ikut bahagia merayakan langkah-langkahmu.'
                : tasks.length > 0
                  ? 'Belum ada tugas aktif yang menunggu. Tambahkan satu hal kecil saat kamu siap.'
                  : 'Yuk, tambahkan satu hal kecil yang ingin kamu selesaikan hari ini.'}
          </p>
          {deadline && (
            <div className="hero-deadline">
              <div className="hero-deadline-label">
                <span>
                  <Clock3 size={13} />
                  {deadline.remainingMilliseconds <= 0
                    ? `Terlambat ${formatDeadlineTime(deadline.remainingMilliseconds)}`
                    : `${formatDeadlineTime(deadline.remainingMilliseconds)} lagi`}
                </span>
                <strong>
                  {Math.round(deadline.remainingPercentage)}% waktu tersisa
                </strong>
              </div>
              <div className="hero-deadline-track">
                <span style={{ width: `${deadline.remainingPercentage}%` }} />
              </div>
            </div>
          )}
          {urgentTask || allTasksCompleted ? (
            <Link className="button button-primary" to="/tasks">
              <ArrowRight size={16} />
              {urgentTask ? 'Lihat semua tugas' : 'Lihat tugas selesai'}
            </Link>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={() => setTaskFormOpen(true)}
            >
              <Plus size={17} /> Buat tugas baru
            </button>
          )}
        </div>
        <div className="hero-companion-wrap">
          <div className="halo" />
          <CharacterPresence
            className="hero-companion"
            mood={mood}
            label={`Karakter MoodTask, ${taskMoodLabels[mood].toLowerCase()}`}
          />
          <div className={`mood-tag mood-tag-${mood}`}>
            <span>✳</span> {taskMoodLabels[mood]}
          </div>
          <div className="floating-star star-a">✳</div>
          <div className="floating-star star-b">·</div>
        </div>
        <div className="hero-index">
          01{' '}
          <span>
            / {String(Math.max(activeTasks.length, 1)).padStart(2, '0')}
          </span>
        </div>
      </section>

      <section className="section-heading">
        <div>
          <div className="section-kicker">HARI INI</div>
          <h2>Ruang untuk fokus</h2>
        </div>
        <Link to="/tasks" className="text-link">
          Lihat semua <ArrowRight size={16} />
        </Link>
      </section>

      <section className="summary-grid" aria-label="Ringkasan hari ini">
        <Link
          className="summary-card focus-card"
          to="/tasks?filter=active"
          aria-label={`Buka daftar tugas aktif (${activeTasks.length})`}
        >
          <div className="summary-icon sage">
            <Leaf size={18} />
          </div>
          <div className="summary-value">{activeTasks.length}</div>
          <div className="summary-label">Tugas aktif</div>
          <span className="summary-detail">Lihat daftar tugas aktif</span>
          <div className="card-decoration">
            <span />
          </div>
        </Link>
        <Link
          className="summary-card"
          to="/tasks?filter=attention"
          aria-label={`Buka daftar tugas yang perlu perhatian (${attentionCount})`}
        >
          <div className="summary-icon peach">
            <Clock3 size={18} />
          </div>
          <div className="summary-value">{attentionCount}</div>
          <div className="summary-label">Perlu perhatian</div>
          <span className="summary-detail">Lihat yang perlu perhatian</span>
        </Link>
        <Link
          className="summary-card"
          to="/tasks?filter=completed-today"
          aria-label={`Buka daftar tugas selesai hari ini (${completedToday})`}
        >
          <div className="summary-icon lilac">
            <Check size={18} />
          </div>
          <div className="summary-value">{completedToday}</div>
          <div className="summary-label">Selesai hari ini</div>
          <span className="summary-detail">Lihat tugas yang selesai</span>
        </Link>
      </section>

      <section className="bottom-grid">
        <article className="panel task-panel">
          <div className="panel-heading">
            <div>
              <div className="section-kicker">LANGKAH BERIKUTNYA</div>
              <h3>Tugas aktif terdekat</h3>
            </div>
            <Link to="/tasks" className="round-link" aria-label="Buka tugas">
              <ArrowUpRight size={18} />
            </Link>
          </div>
          {nextTasks.length > 0 ? (
            <div className="dashboard-task-list">
              {nextTasks.map((task) => {
                const taskMood = getTaskMood(task, now)
                const taskDeadline = calculateDeadlineState(
                  task.startAt,
                  task.deadlineAt,
                  now,
                )
                return (
                  <Link
                    key={task.id}
                    to="/tasks"
                    className="dashboard-task-row"
                  >
                    <span
                      className={`dashboard-task-dot mood-${taskMood ?? 'calm'}`}
                    />
                    <span className="dashboard-task-name">{task.title}</span>
                    <span className="dashboard-task-percent">
                      {Math.round(taskDeadline.remainingPercentage)}%
                    </span>
                  </Link>
                )
              })}
              <Link to="/tasks" className="text-link dashboard-more-link">
                Buka daftar tugas <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="empty-tasks">
              <div className="empty-illustration">
                <div className="empty-sun">✳</div>
                <div className="empty-line line-one" />
                <div className="empty-line line-two" />
                <div className="empty-line line-three" />
              </div>
              <strong>
                {allTasksCompleted
                  ? 'Semua tugas sudah selesai'
                  : tasks.length > 0
                    ? 'Belum ada tugas aktif'
                    : 'Belum ada tugas yang menunggu'}
              </strong>
              <span>
                {allTasksCompleted
                  ? 'Momo ikut bahagia merayakan semua langkahmu.'
                  : 'Yuk, tambahkan satu hal kecil yang ingin kamu selesaikan hari ini.'}
              </span>
              {!allTasksCompleted ? (
                <button
                  type="button"
                  className="text-link dashboard-create-link"
                  onClick={() => setTaskFormOpen(true)}
                >
                  Buat tugas baru <Plus size={15} />
                </button>
              ) : (
                <Link to="/tasks" className="text-link">
                  Lihat semua tugas <ArrowRight size={15} />
                </Link>
              )}
            </div>
          )}
        </article>
        <article className="panel note-panel">
          <div className="note-top">
            <div className="summary-icon lilac">
              <Sparkles size={17} />
            </div>
            <span className="section-kicker">PENGINGAT KECIL</span>
          </div>
          <div className="note-quote">
            “Kamu tidak harus menyelesaikan semuanya hari ini.”
          </div>
          <p>Yang penting adalah memberi dirimu kesempatan untuk mulai.</p>
          <div className="note-footer">
            <span className="note-flower">✳</span>
            <span>Catatan untuk hari ini</span>
          </div>
        </article>
      </section>
      <TaskFormDialog
        key={`${taskFormOpen ? 'open' : 'closed'}-new`}
        open={taskFormOpen}
        onClose={() => setTaskFormOpen(false)}
        onSave={saveDashboardTask}
      />
    </>
  )
}
