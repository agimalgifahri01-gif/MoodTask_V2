import { useMemo, useState, type FormEvent } from 'react'
import { Bell, BellOff, Plus, Trash2 } from 'lucide-react'
import type { Task } from '../tasks/domain'
import { formatTaskDate } from '../tasks/presentation'
import { useCurrentTime } from '../tasks/useCurrentTime'
import { useOptionalReminderSettings } from './ReminderSettingsContext'
import ReminderDurationFields from './ReminderDurationFields'
import {
  formatReminderOffset,
  getReminderDurationMinutes,
  validateNewReminderSchedule,
  type TaskReminder,
  type ReminderDurationInput,
} from './model'

function scheduledAt(task: Task, reminder: TaskReminder) {
  return new Date(
    Date.parse(task.deadlineAt) - reminder.minutesBefore * 60_000,
  ).toISOString()
}

export default function ReminderScheduleEditor({ task }: { task: Task }) {
  const settings = useOptionalReminderSettings()
  const now = useCurrentTime()
  const repositoryAvailable = settings?.repositoryAvailable ?? false
  const loading = settings?.loading ?? false
  const repositoryError = settings?.error ?? null
  const [duration, setDuration] = useState<ReminderDurationInput>({
    days: '',
    hours: '',
    minutes: '',
  })
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const taskReminders = useMemo(() => {
    const list = settings?.reminders ?? []
    return list.filter((reminder) => reminder.taskId === task.id)
  }, [settings?.reminders, task.id])
  const active = task.status === 'active'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setError('')
    setMessage('')
    setSaving(true)
    try {
      const minutesBefore = getReminderDurationMinutes(duration)
      if (minutesBefore === null) {
        throw new Error('Masukkan durasi atau pilih tanpa menambah pengingat.')
      }
      validateNewReminderSchedule(
        task.startAt,
        task.deadlineAt,
        minutesBefore,
        now,
      )
      const existing = taskReminders.find(
        (reminder) => reminder.minutesBefore === minutesBefore,
      )
      if (existing?.enabled) {
        throw new Error('Waktu pengingat tersebut sudah ada.')
      }
      if (!settings) throw new Error('Pengaturan pengingat belum tersedia.')
      await settings.saveReminder(task, minutesBefore, true)
      setMessage(
        existing
          ? `Pengingat ${formatReminderOffset(minutesBefore)} diaktifkan kembali.`
          : `Pengingat ${formatReminderOffset(minutesBefore)} ditambahkan.`,
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Jadwal belum dapat disimpan. Coba lagi.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function toggle(reminder: TaskReminder, enabled: boolean) {
    setError('')
    setMessage('')
    setBusyRuleId(reminder.id)
    try {
      if (!settings) throw new Error('Pengaturan pengingat belum tersedia.')
      if (enabled) {
        validateNewReminderSchedule(
          task.startAt,
          task.deadlineAt,
          reminder.minutesBefore,
          now,
        )
      }
      await settings.saveReminder(task, reminder.minutesBefore, enabled)
      setMessage(
        enabled
          ? `Pengingat ${formatReminderOffset(reminder.minutesBefore)} diaktifkan.`
          : `Pengingat ${formatReminderOffset(reminder.minutesBefore)} dinonaktifkan.`,
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Pengaturan pengingat belum dapat diperbarui.',
      )
    } finally {
      setBusyRuleId(null)
    }
  }

  async function remove(reminder: TaskReminder) {
    setError('')
    setMessage('')
    setBusyRuleId(reminder.id)
    try {
      if (!settings) throw new Error('Pengaturan pengingat belum tersedia.')
      await settings.removeReminder(reminder.id)
      setMessage(
        `Pengingat ${formatReminderOffset(reminder.minutesBefore)} dihapus.`,
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Pengingat belum dapat dihapus.',
      )
    } finally {
      setBusyRuleId(null)
    }
  }

  return (
    <section
      className="reminder-editor"
      aria-labelledby={`reminders-${task.id}`}
    >
      <div className="reminder-editor-heading">
        <span className="reminder-editor-icon" aria-hidden="true">
          <Bell size={15} />
        </span>
        <div>
          <h3 id={`reminders-${task.id}`}>Jadwal Momo</h3>
          <p>Pengingat dihitung dari deadline tugas terbaru.</p>
        </div>
      </div>

      {!repositoryAvailable ? (
        <div className="reminder-inline-note">
          Masuk ke akun MoodTask untuk menyimpan jadwal dan mengaktifkan push di
          perangkat ini.
        </div>
      ) : loading ? (
        <p className="reminder-inline-note" role="status">
          Memuat jadwal pengingat…
        </p>
      ) : (
        <>
          {taskReminders.length > 0 ? (
            <ul className="reminder-schedule-list">
              {taskReminders.map((reminder) => {
                const upcomingAt = scheduledAt(task, reminder)
                return (
                  <li className="reminder-schedule" key={reminder.id}>
                    <label className="reminder-schedule-toggle">
                      <input
                        type="checkbox"
                        checked={reminder.enabled}
                        disabled={
                          busyRuleId === reminder.id || task.status !== 'active'
                        }
                        onChange={(event) =>
                          void toggle(reminder, event.target.checked)
                        }
                        aria-label={`${reminder.enabled ? 'Nonaktifkan' : 'Aktifkan'} pengingat ${formatReminderOffset(reminder.minutesBefore)} sebelum deadline`}
                      />
                      <span className="reminder-schedule-copy">
                        <strong>
                          {formatReminderOffset(reminder.minutesBefore)} sebelum
                          deadline
                        </strong>
                        <small>
                          {reminder.enabled
                            ? `Dijadwalkan ${formatTaskDate(upcomingAt)}`
                            : 'Pengingat dinonaktifkan'}
                        </small>
                      </span>
                    </label>
                    <button
                      type="button"
                      className="reminder-remove-button"
                      onClick={() => void remove(reminder)}
                      disabled={busyRuleId === reminder.id}
                      aria-label={`Hapus pengingat ${formatReminderOffset(reminder.minutesBefore)}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="reminder-inline-note">
              Belum ada jadwal. Tambahkan waktu pengingat yang sesuai ritmemu.
            </p>
          )}

          {active ? (
            <form
              className="reminder-add-form"
              onSubmit={(event) => void submit(event)}
            >
              <ReminderDurationFields
                value={duration}
                onChange={(unit, value) =>
                  setDuration((current) => ({ ...current, [unit]: value }))
                }
              />
              <button
                type="submit"
                className="button button-quiet"
                disabled={saving}
              >
                <Plus size={15} /> {saving ? 'Menyimpan…' : 'Tambah'}
              </button>
            </form>
          ) : (
            <p className="reminder-inline-note">
              <BellOff size={14} aria-hidden="true" /> Tugas{' '}
              {task.status === 'completed' ? 'selesai' : 'dibatalkan'};
              pengingat tidak akan dikirim.
            </p>
          )}
        </>
      )}

      {(error || repositoryError) && (
        <p className="reminder-feedback is-error" role="alert">
          {error || repositoryError}
        </p>
      )}
      {message && (
        <p className="reminder-feedback" role="status">
          {message}
        </p>
      )}
      {repositoryAvailable && (
        <p className="reminder-delivery-note">
          Pengiriman saat browser tertutup memerlukan push server yang sudah
          dikonfigurasi.
        </p>
      )}
    </section>
  )
}
