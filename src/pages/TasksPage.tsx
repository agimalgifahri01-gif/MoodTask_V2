import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowDownWideNarrow,
  CircleHelp,
  Plus,
  Search,
} from 'lucide-react'
import PageIntro from '../components/PageIntro'
import TaskDetailsDialog from '../features/tasks/TaskDetailsDialog'
import TaskCard from '../features/tasks/TaskCard'
import TaskFormDialog from '../features/tasks/TaskFormDialog'
import {
  type Task,
  type TaskDraft,
  type TaskStatus,
} from '../features/tasks/domain'
import {
  getTasksCompletedToday,
  getTasksNeedingAttention,
  getVisibleTasks,
} from '../features/tasks/presentation'
import { useTasks } from '../features/tasks/TaskContext'
import { useCurrentTime } from '../features/tasks/useCurrentTime'
import { useOptionalReminderSettings } from '../features/reminders/ReminderSettingsContext'

type Filter = TaskStatus | 'all' | 'attention' | 'completed-today'
type Sort = 'deadline' | 'priority' | 'recent'

function parseFilter(value: string | null): Filter {
  if (
    value === 'active' ||
    value === 'completed' ||
    value === 'cancelled' ||
    value === 'attention' ||
    value === 'completed-today'
  ) {
    return value
  }
  return 'all'
}

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'active', label: 'Aktif' },
  { value: 'completed', label: 'Selesai' },
  { value: 'completed-today', label: 'Selesai hari ini' },
  { value: 'attention', label: 'Perlu perhatian' },
  { value: 'cancelled', label: 'Dibatalkan' },
]

export default function TasksPage() {
  const {
    tasks,
    storageMode,
    persistenceWarning,
    loading,
    loadError,
    reload,
    createTask,
    updateTask,
    setStatus,
    deleteTask,
  } = useTasks()
  const now = useCurrentTime()
  const reminderSettings = useOptionalReminderSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseFilter(searchParams.get('filter'))
  const [sort, setSort] = useState<Sort>('deadline')
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null)

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  const visibleTasks = useMemo(
    () => getVisibleTasks(tasks, query, filter, sort, now),
    [tasks, query, filter, sort, now],
  )
  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((task) => task.status === 'active').length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      'completed-today': getTasksCompletedToday(tasks, now).length,
      attention: getTasksNeedingAttention(tasks, now).length,
      cancelled: tasks.filter((task) => task.status === 'cancelled').length,
    }),
    [tasks, now],
  )

  useEffect(() => {
    const taskId = searchParams.get('open')
    if (!taskId || loading || !tasks.some((task) => task.id === taskId)) return
    const timer = setTimeout(() => {
      setSelectedTaskId(taskId)
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('open')
      setSearchParams(nextParams, { replace: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [loading, searchParams, setSearchParams, tasks])

  function chooseFilter(nextFilter: Filter) {
    const nextParams = new URLSearchParams(searchParams)
    if (nextFilter === 'all') nextParams.delete('filter')
    else nextParams.set('filter', nextFilter)
    setSearchParams(nextParams)
  }

  if (loading) {
    return (
      <div className="app-state" role="status" aria-live="polite">
        <strong>Memuat daftar tugas…</strong>
      </div>
    )
  }

  function openCreate() {
    setEditingTask(null)
    setError('')
    setNotice('')
    setFormOpen(true)
  }

  function openEdit(task: Task) {
    setSelectedTaskId(null)
    setEditingTask(task)
    setError('')
    setFormOpen(true)
  }

  async function saveTask(
    draft: TaskDraft,
    reminderMinutesBefore: number | null,
  ) {
    try {
      if (editingTask) {
        await updateTask(editingTask.id, draft)
        setNotice('Perubahan tugas berhasil disimpan.')
      } else {
        const task = await createTask(draft)
        if (reminderMinutesBefore !== null) {
          try {
            if (!reminderSettings?.repositoryAvailable) {
              throw new Error('Jadwal pengingat memerlukan akun MoodTask.')
            }
            await reminderSettings.saveReminder(
              task,
              reminderMinutesBefore,
              true,
            )
            setNotice('Tugas dan jadwal pengingat berhasil disimpan.')
          } catch {
            setNotice(
              'Tugas tersimpan, tetapi jadwal pengingat gagal disimpan. Tambahkan pengingat dari rincian tugas.',
            )
          }
        } else {
          setNotice('Tugas baru berhasil ditambahkan.')
        }
      }
      setEditingTask(null)
      setFormOpen(false)
    } catch (caught) {
      const failure =
        caught instanceof Error
          ? caught
          : new Error('Tugas belum dapat disimpan. Coba lagi.')
      throw failure
    }
  }

  async function changeStatus(task: Task, status: TaskStatus) {
    if (pendingTaskId) return
    const message =
      status === 'completed'
        ? `Tandai “${task.title}” sebagai selesai?`
        : status === 'cancelled'
          ? `Batalkan “${task.title}”? Kamu dapat mengaktifkannya kembali.`
          : `Aktifkan kembali “${task.title}”?`
    if (status !== 'completed' && !window.confirm(message)) return

    setPendingTaskId(task.id)
    try {
      await setStatus(task.id, status)
      setNotice(
        status === 'completed'
          ? 'Tugas ditandai selesai. Momo ikut senang!'
          : status === 'cancelled'
            ? 'Tugas dibatalkan.'
            : 'Tugas diaktifkan kembali.',
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Status belum dapat diubah.',
      )
    } finally {
      setPendingTaskId(null)
    }
  }

  async function removeTask(task: Task) {
    if (pendingTaskId) return
    const scope =
      storageMode === 'cloud'
        ? 'dari akun MoodTask'
        : 'dari penyimpanan browser di perangkat ini'
    if (!window.confirm(`Hapus “${task.title}” secara permanen ${scope}?`)) {
      return
    }
    setPendingTaskId(task.id)
    try {
      await deleteTask(task.id)
      setSelectedTaskId(null)
      setNotice('Tugas berhasil dihapus.')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Tugas belum dapat dihapus.',
      )
    } finally {
      setPendingTaskId(null)
    }
  }

  return (
    <>
      <div className="tasks-page-intro">
        <PageIntro
          eyebrow="DAFTAR HARIAN"
          title="Tugas saya"
          description="Simpan hal yang ingin kamu selesaikan, lalu kerjakan satu per satu."
        />
        <button
          type="button"
          className="button button-primary add-task-button"
          onClick={openCreate}
        >
          <Plus size={17} /> Tugas baru
        </button>
      </div>

      <div className="session-notice">
        <CircleHelp size={15} />
        <span>
          {storageMode === 'cloud'
            ? 'Tugas disimpan ke akun MoodTask. Perangkat lain akan memuat perubahan saat dibuka atau dimuat ulang.'
            : 'Tugas tersimpan di penyimpanan browser pada perangkat ini. Data belum disinkronkan ke akun atau perangkat lain.'}
        </span>
      </div>

      {persistenceWarning && (
        <div className="task-feedback feedback-error" role="alert">
          <AlertCircle size={15} /> {persistenceWarning}
        </div>
      )}

      {loadError && (
        <div className="task-feedback feedback-error" role="alert">
          <AlertCircle size={15} /> {loadError}
          <button type="button" onClick={() => void reload()}>
            Coba lagi
          </button>
        </div>
      )}

      {notice && (
        <div className="task-feedback" role="status">
          <span className="status-dot" /> {notice}
          <button
            type="button"
            onClick={() => setNotice('')}
            aria-label="Tutup pesan"
          >
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="task-feedback feedback-error" role="alert">
          <AlertCircle size={15} /> {error}
          <button
            type="button"
            onClick={() => setError('')}
            aria-label="Tutup pesan"
          >
            ×
          </button>
        </div>
      )}

      <section className="task-controls" aria-label="Cari dan saring tugas">
        <div
          className="task-filter-row"
          role="group"
          aria-label="Filter status tugas"
        >
          {filters.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`filter-chip${filter === value ? ' selected' : ''}`}
              onClick={() => chooseFilter(value)}
              aria-pressed={filter === value}
            >
              {label}
              <span>{counts[value]}</span>
            </button>
          ))}
        </div>
        <div className="task-search-sort">
          <label className="task-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Cari tugas</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari tugas atau catatan…"
            />
          </label>
          <label className="task-sort">
            <ArrowDownWideNarrow size={15} aria-hidden="true" />
            <span className="sr-only">Urutkan tugas</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="deadline">Deadline terdekat</option>
              <option value="priority">Prioritas</option>
              <option value="recent">Terbaru dibuat</option>
            </select>
          </label>
        </div>
      </section>

      {visibleTasks.length > 0 ? (
        <section className="task-grid" aria-label="Daftar tugas">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              now={now}
              busy={pendingTaskId === task.id}
              onOpen={(selected) => setSelectedTaskId(selected.id)}
              onStatusChange={changeStatus}
            />
          ))}
        </section>
      ) : (
        <section className="task-list-empty" aria-live="polite">
          <div className="empty-task-icon">
            {query || filter !== 'all' ? (
              <Search size={23} />
            ) : (
              <Plus size={24} />
            )}
          </div>
          <h2>
            {query || filter !== 'all'
              ? 'Belum ada yang cocok'
              : 'Mulai dengan satu hal'}
          </h2>
          <p>
            {query || filter !== 'all'
              ? 'Coba ubah kata pencarian atau pilihan filter.'
              : 'Tambahkan tugas pertamamu. Waktu tersisa dan mood Momo akan dihitung dari deadline yang kamu pilih.'}
          </p>
          {query || filter !== 'all' ? (
            <button
              type="button"
              className="text-link reset-filter"
              onClick={() => {
                setQuery('')
                chooseFilter('all')
              }}
            >
              Hapus pencarian dan filter
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={openCreate}
            >
              <Plus size={16} /> Tambah tugas pertama
            </button>
          )}
        </section>
      )}

      {tasks.length > 0 && (
        <p className="task-count-caption" aria-live="polite">
          Menampilkan {visibleTasks.length} dari {tasks.length} tugas
        </p>
      )}

      <TaskFormDialog
        key={`${formOpen ? 'open' : 'closed'}-${editingTask?.id ?? 'new'}`}
        open={formOpen}
        task={editingTask}
        onClose={() => {
          setFormOpen(false)
          setEditingTask(null)
        }}
        onSave={saveTask}
      />
      <TaskDetailsDialog
        task={selectedTask}
        now={now}
        onClose={() => setSelectedTaskId(null)}
        onEdit={openEdit}
        onStatusChange={changeStatus}
        onDelete={removeTask}
        busy={selectedTask ? pendingTaskId === selectedTask.id : false}
      />
    </>
  )
}
