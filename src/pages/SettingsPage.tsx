import PageIntro from '../components/PageIntro'
import NotificationSoundSettings from '../features/reminders/NotificationSoundSettings'
import { useReminderSettings } from '../features/reminders/ReminderSettingsContext'

export default function SettingsPage() {
  const settings = useReminderSettings()
  return (
    <>
      <PageIntro
        eyebrow="PREFERENSI"
        title="Pengaturan"
        description="Atur pengalaman notifikasi MoodTask sesuai ritmemu."
      />
      {settings.soundLoading ? (
        <div className="app-state" role="status">
          <strong>Memuat preferensi suara…</strong>
        </div>
      ) : (
        <NotificationSoundSettings settings={settings} />
      )}
    </>
  )
}
