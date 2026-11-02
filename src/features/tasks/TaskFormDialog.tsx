import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell, BellOff, X } from 'lucide-react'
import type { Task, TaskDraft, TaskPriority } from './domain'
import {
  formatReminderOffset,
  getReminderDurationMinutes,
  validateNewReminderSchedule,
  type ReminderDurationInput,
} from '../reminders/model'
import { useOptionalReminderSettings } from '../reminders/ReminderSettingsContext'
import ReminderDurationFields from '../reminders/ReminderDurationFields'

type FormValues = {
  title: string
  description: string
  startAt: string
  deadlineAt: string
  priority: TaskPriority
}

type Props = {
  open: boolean
  task?: Task | null
  onClose: () => void
  onSave: (
    draft: TaskDraft,
    reminderMinutesBefore: number | null,
  ) => void | Promise<void>
}

function toLocalDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function getInitialValues(task?: Task | null): FormValues {
  if (task) {
    return {
      title: task.title,
      description: task.description,
      startAt: toLocalDateTime(new Date(task.startAt)),
      deadlineAt: toLocalDateTime(new Date(task.deadlineAt)),
      priority: task.priority,
    }
  }

  const start = new Date()
  start.setSeconds(0, 0)
  const deadline = new Date(start.getTime() + 60 * 60 * 1000)
  return {
    title: '',
    description: '',
    startAt: toLocalDateTime(start),
    deadlineAt: toLocalDateTime(deadline),
    priority: 'medium',
  }
}

export default function TaskFormDialog({ open, task, onClose, onSave }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const reminderSettings = useOptionalReminderSettings()
  const [values, setValues] = useState<FormValues>(() => getInitialValues(task))
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderDuration, setReminderDuration] =
    useState<ReminderDurationInput>({ days: '', hours: '', minutes: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    if (error) setError('')
  }

  function updateReminderDuration(
    unit: keyof ReminderDurationInput,
    value: string,
  ) {
    setReminderDuration((current) => ({ ...current, [unit]: value }))
    if (error) setError('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const draft = {
        title: values.title,
        description: values.description,
        startAt: new Date(values.startAt).toISOString(),
        deadlineAt: new Date(values.deadlineAt).toISOString(),
        priority: values.priority,
      }
      let reminderMinutesBefore: number | null = null
      if (reminderEnabled && !task) {
        if (!reminderSettings?.repositoryAvailable) {
          throw new Error(
            'Masuk ke akun MoodTask untuk menyimpan pengingat bersama tugas.',
          )
        }
        reminderMinutesBefore = getReminderDurationMinutes(reminderDuration)
        if (reminderMinutesBefore === null) {
          throw new Error(
            'Isi durasi pengingat atau matikan pengingat untuk menyimpan tanpa jadwal.',
          )
        }
        validateNewReminderSchedule(
          draft.startAt,
          draft.deadlineAt,
          reminderMinutesBefore,
          Date.now(),
        )
      }
      await onSave(draft, reminderMinutesBefore)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Tugas belum dapat disimpan. Periksa kembali isianmu.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog
      className="task-dialog"
      ref={dialogRef}
      aria-labelledby="task-form-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <form className="task-form" onSubmit={handleSubmit}>
        <div className="dialog-heading">
          <div>
            <span className="section-kicker">
              {task ? 'PERBARUI RENCANA' : 'LANGKAH BARU'}
            </span>
            <h2 id="task-form-title">{task ? 'Ubah tugas' : 'Buat tugas'}</h2>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label="Tutup formulir"
          >
            <X size={19} />
          </button>
        </div>

        <label className="form-field">
          <span>
            Judul tugas <span className="required-mark">*</span>
          </span>
          <input
            autoFocus
            required
            maxLength={120}
            value={values.title}
            onChange={(event) => update('title', event.target.value)}
            placeholder="Contoh: Menyusun laporan mingguan"
          />
          <small>Maksimal 120 karakter</small>
        </label>

        {!task && (
          <section
            className="task-form-reminder"
            aria-labelledby="new-task-reminder-title"
          >
            <div className="task-form-reminder-heading">
              {reminderEnabled ? <Bell size={17} /> : <BellOff size={17} />}
              <div>
                <strong id="new-task-reminder-title">
                  Pengingat dan notifikasi
                </strong>
                <small>
                  Atur satu pengingat awal; jadwal lain bisa ditambahkan nanti.
                </small>
              </div>
              <label className="task-reminder-switch">
                <span className="sr-only">
                  Aktifkan pengingat untuk tugas ini
                </span>
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  disabled={!reminderSettings?.repositoryAvailable}
                  onChange={(event) => setReminderEnabled(event.target.checked)}
                />
                <span aria-hidden="true" />
              </label>
            </div>
            {reminderEnabled ? (
              <>
                <ReminderDurationFields
                  value={reminderDuration}
                  onChange={updateReminderDuration}
                />
                <p className="task-reminder-summary" aria-live="polite">
                  {(() => {
                    try {
                      const minutes =
                        getReminderDurationMinutes(reminderDuration)
                      if (minutes === null) {
                        return 'Isi hari, jam, atau menit untuk melihat ringkasan jadwal.'
                      }
                      const scheduledAt =
                        Date.parse(values.deadlineAt) - minutes * 60_000
                      if (!Number.isFinite(scheduledAt)) {
                        return 'Jadwal dihitung dari deadline yang dipilih.'
                      }
                      return `Momo akan mengingatkan ${formatReminderOffset(minutes)} sebelum deadline, sekitar ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduledAt))}.`
                    } catch {
                      return 'Durasi belum valid. Gunakan bilangan bulat nol atau lebih.'
                    }
                  })()}
                </p>
              </>
            ) : (
              <p className="task-reminder-help">
                Pengingat nonaktif. Tugas ini akan disimpan tanpa jadwal.
              </p>
            )}
            {!reminderSettings?.repositoryAvailable ? (
              <p className="task-reminder-help">
                Jadwal tersimpan di akun. Masuk ke MoodTask untuk mengaturnya;
                tugas lokal tetap dapat disimpan tanpa pengingat.
              </p>
            ) : reminderSettings.pushCapability === 'unsupported' ? (
              <p className="task-reminder-help">
                Browser ini tidak mendukung push. Jadwal tetap tersimpan di
                akun, tetapi perangkat ini tidak dapat menerima notifikasi
                browser.
              </p>
            ) : reminderSettings.pushCapability === 'denied' ? (
              <p className="task-reminder-help">
                Izin notifikasi browser ditolak. Ubah izin MoodTask di
                pengaturan browser; jadwal tetap tersimpan di akun.
              </p>
            ) : reminderSettings.pushCapability === 'not-configured' ? (
              <p className="task-reminder-help">
                Push belum dikonfigurasi pada lingkungan ini. Jadwal tetap
                tersimpan di akun, tetapi notifikasi browser belum dapat
                didaftarkan.
              </p>
            ) : reminderSettings.pushSubscribed ? (
              <p className="task-reminder-help">
                Perangkat ini sudah terdaftar. Push saat browser tertutup tetap
                memerlukan scheduler server yang aktif.
              </p>
            ) : (
              <p className="task-reminder-help">
                Jadwal akan tersimpan di akun. Untuk notifikasi browser,
                aktifkan izin dan perangkat ini di halaman Pengingat; izin hanya
                diminta setelah kamu menekan tombol aktifkan di sana.
              </p>
            )}
          </section>
        )}

        <label className="form-field">
          <span>
            Catatan <span className="optional-mark">OPSIONAL</span>
          </span>
          <textarea
            maxLength={2000}
            rows={3}
            value={values.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="Tambahkan detail yang membantumu mulai."
          />
        </label>

        <div className="form-row">
          <label className="form-field">
            <span>
              Waktu mulai <span className="required-mark">*</span>
            </span>
            <input
              type="datetime-local"
              required
              value={values.startAt}
              onChange={(event) => update('startAt', event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>
              Deadline <span className="required-mark">*</span>
            </span>
            <input
              type="datetime-local"
              required
              value={values.deadlineAt}
              onChange={(event) => update('deadlineAt', event.target.value)}
            />
          </label>
        </div>

        <label className="form-field">
          <span>Prioritas</span>
          <select
            value={values.priority}
            onChange={(event) =>
              update('priority', event.target.value as TaskPriority)
            }
          >
            <option value="low">Rendah</option>
            <option value="medium">Sedang</option>
            <option value="high">Tinggi</option>
          </select>
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Batal
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={saving}
          >
            {saving ? 'Menyimpan…' : task ? 'Simpan perubahan' : 'Simpan tugas'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
