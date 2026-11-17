import PageIntro from '../components/PageIntro'
import NotificationSoundSettings from '../features/reminders/NotificationSoundSettings'
import NativeSoundDiagnosticsPanel from '../features/reminders/NativeSoundDiagnosticsPanel'
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
      <NativeSoundDiagnosticsPanel
        diagnostics={settings.nativeSoundDiagnostics}
        soundId={settings.soundPreference.soundId}
        onClear={settings.clearNativeSoundDiagnostics}
      />
    </>
  )
}
