import { useState } from 'react'
import { BellRing, CircleAlert, Smartphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageIntro from '../components/PageIntro'
import ReminderScheduleEditor from '../features/reminders/ReminderScheduleEditor'
import { formatReminderOffset } from '../features/reminders/model'
import { useReminderSettings } from '../features/reminders/ReminderSettingsContext'
import { getActiveTasksByUrgency } from '../features/tasks/presentation'
import { useTasks } from '../features/tasks/TaskContext'
import { useCurrentTime } from '../features/tasks/useCurrentTime'

function pushStatusText(
  capability: ReturnType<typeof useReminderSettings>['pushCapability'],
  subscribed: boolean,
) {
  if (capability === 'unsupported') {
    return 'Browser ini belum mendukung push. Jadwal tetap tersimpan di akun, tetapi perangkat ini tidak dapat menerima notifikasi browser.'
  }
  if (capability === 'denied') {
    return 'Izin notifikasi ditolak. Ubah izin MoodTask di pengaturan browser untuk mengaktifkannya.'
  }
  if (capability === 'not-configured') {
    return 'Kunci publik push belum tersedia di lingkungan ini. Pengingat belum dapat didaftarkan ke browser.'
  }
  if (subscribed) {
    return 'Browser ini sudah terdaftar untuk menerima push saat server scheduler aktif.'
  }
  if (capability === 'ready') {
    return 'Izin browser sudah tersedia. Daftarkan perangkat ini agar dapat menerima push.'
  }
  return 'Aktifkan izin notifikasi untuk mendaftarkan perangkat ini.'
}

export default function RemindersPage() {
  const { tasks, loading: tasksLoading, loadError } = useTasks()
  const settings = useReminderSettings()
  const now = useCurrentTime()
  const [pushActionError, setPushActionError] = useState('')
  const activeTasks = getActiveTasksByUrgency(tasks, now)
  const enabledCount = settings.reminders.filter((item) => item.enabled).length

  async function togglePush() {
    setPushActionError('')
    try {
      if (settings.pushSubscribed) await settings.disablePush()
      else await settings.enablePush()
    } catch (caught) {
      setPushActionError(
        caught instanceof Error
          ? caught.message
          : 'Pengaturan push belum dapat diperbarui.',
      )
    }
  }

  return (
    <>
      <PageIntro
        eyebrow="PENGINGAT"
        title="Ditemani di waktu yang tepat"
        description="Atur beberapa pengingat untuk setiap tugas. Momo menyesuaikan mood-nya dengan deadline terbaru saat notifikasi dikirim."
      />

      <section className="push-settings-panel" aria-labelledby="push-title">
        <div className="push-settings-icon" aria-hidden="true">
          <Smartphone size={20} />
        </div>
        <div className="push-settings-copy">
          <span className="section-kicker">PERANGKAT INI</span>
          <h2 id="push-title">Notifikasi browser</h2>
          <p>
            {pushStatusText(settings.pushCapability, settings.pushSubscribed)}
          </p>
          <p className="push-setup-note">
            Pengiriman saat browser tertutup memerlukan Edge Function dan
            scheduler server yang telah dipasang. Izin browser saja tidak
            menjamin push terkirim.
          </p>
        </div>
        {settings.repositoryAvailable &&
          (settings.pushCapability === 'needs-permission' ||
            settings.pushCapability === 'ready' ||
            settings.pushSubscribed) && (
            <button
              type="button"
              className={
                settings.pushSubscribed
                  ? 'button button-quiet'
                  : 'button button-primary'
              }
              onClick={() => void togglePush()}
              disabled={settings.pushBusy}
            >
              <BellRing size={16} />
              {settings.pushBusy
                ? 'Memproses…'
                : settings.pushSubscribed
                  ? 'Matikan di perangkat ini'
                  : 'Aktifkan notifikasi'}
            </button>
          )}
      </section>

      {!settings.repositoryAvailable && (
        <div className="reminder-account-note" role="note">
          <CircleAlert size={17} aria-hidden="true" />
          <span>
            Jadwal dan langganan push disimpan dengan aman pada akun.{' '}
            <Link to="/auth">Masuk ke akun MoodTask</Link> untuk mengaturnya;
            tugas lokal tidak dikirim ke server.
          </span>
        </div>
      )}

      {(pushActionError || settings.error || loadError) && (
        <div className="task-feedback feedback-error" role="alert">
          {pushActionError || settings.error || loadError}
        </div>
      )}

      <div className="reminder-list-heading">
        <div>
          <span className="section-kicker">TUGAS AKTIF</span>
          <h2>Jadwal pengingatmu</h2>
        </div>
        <span className="reminder-count">
          {settings.loading ? 'Memuat…' : `${enabledCount} pengingat aktif`}
        </span>
      </div>

      {tasksLoading || settings.loading ? (
        <div className="reminder-page-loading" role="status">
          Menyiapkan daftar pengingat…
        </div>
      ) : activeTasks.length ? (
        <div className="reminder-task-list">
          {activeTasks.map((task) => {
            const taskReminders = settings.reminders
              .filter((reminder) => reminder.taskId === task.id)
              .sort((left, right) => left.minutesBefore - right.minutesBefore)
            const taskLink = `/tasks?open=${encodeURIComponent(task.id)}`
            return (
              <article className="reminder-task-card" key={task.id}>
                <header className="reminder-task-header">
                  <div>
                    <span className="section-kicker">
                      {taskReminders.filter((item) => item.enabled).length
                        ? `${taskReminders.filter((item) => item.enabled).length} PENGINGAT AKTIF`
                        : 'BELUM ADA PENGINGAT'}
                    </span>
                    <h3>
                      <Link to={taskLink}>{task.title}</Link>
                    </h3>
                    <p>
                      {taskReminders.length
                        ? taskReminders
                            .map(
                              (reminder) =>
                                `${formatReminderOffset(reminder.minutesBefore)}${reminder.enabled ? '' : ' (mati)'}`,
                            )
                            .join(' · ')
                        : 'Pilih satu atau beberapa waktu sebelum deadline.'}
                    </p>
                  </div>
                  <Link className="reminder-open-task" to={taskLink}>
                    Buka tugas
                  </Link>
                </header>
                <ReminderScheduleEditor task={task} />
              </article>
            )
          })}
        </div>
      ) : (
        <section className="reminder-empty">
          <div className="coming-icon">
            <BellRing size={23} />
          </div>
          <h2>Belum ada tugas aktif</h2>
          <p>
            Tambahkan tugas lebih dulu. Setelah itu kamu dapat memilih lebih
            dari satu waktu pengingat untuk setiap deadline.
          </p>
          <Link className="button button-primary" to="/tasks">
            Lihat daftar tugas
          </Link>
        </section>
      )}
    </>
  )
}
