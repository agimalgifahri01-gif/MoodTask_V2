import type { NativeSoundDiagnostics } from './ReminderSettingsContext'
import type { NotificationSoundId } from './notificationSound'

function statusLabel(status: NativeSoundDiagnostics['audioUrlStatus']) {
  if (status === 'success') return 'Berhasil'
  if (status === 'failure') return 'Gagal'
  return 'Belum diuji'
}

function playbackStatusLabel(status: NativeSoundDiagnostics['playbackStatus']) {
  switch (status) {
    case 'starting':
      return 'Memulai'
    case 'started':
      return 'Sedang diputar'
    case 'ended':
      return 'Selesai'
    case 'stopped':
      return 'Dihentikan'
    case 'failure':
      return 'Gagal'
    default:
      return 'Belum diuji'
  }
}

export default function NativeSoundDiagnosticsPanel({
  diagnostics,
  soundId,
  onClear,
}: {
  diagnostics: NativeSoundDiagnostics
  soundId: NotificationSoundId
  onClear: () => void
}) {
  if (!import.meta.env.DEV) return null
  const usesCustomSound = soundId === 'custom'

  return (
    <section
      className="sound-settings-panel native-sound-diagnostics"
      aria-labelledby="native-sound-diagnostics-title"
      aria-live="polite"
    >
      <div className="sound-settings-header">
        <div>
          <h2 id="native-sound-diagnostics-title">Diagnostik suara desktop</h2>
          <p>Panel sementara ini hanya aktif dalam mode development.</p>
        </div>
      </div>
      <dl className="native-sound-diagnostics-list">
        <div>
          <dt>Listener event native Tauri</dt>
          <dd>{diagnostics.listenerActive ? 'Aktif' : 'Tidak aktif'}</dd>
        </div>
        <div>
          <dt>Event pengingat diterima React</dt>
          <dd>{diagnostics.eventReceived ? 'Ya' : 'Belum'}</dd>
        </div>
        <div>
          <dt>{usesCustomSound ? 'URL MP3' : 'File suara bawaan'}</dt>
          <dd>
            {usesCustomSound
              ? statusLabel(diagnostics.audioUrlStatus)
              : 'Tidak diperlukan'}
          </dd>
        </div>
        <div>
          <dt>{usesCustomSound ? 'Pemutaran MP3' : 'Pemutaran suara bawaan'}</dt>
          <dd>{playbackStatusLabel(diagnostics.playbackStatus)}</dd>
        </div>
      </dl>
      {diagnostics.error && (
        <p className="native-sound-diagnostics-error" role="status">
          {diagnostics.error}
        </p>
      )}
      <button className="button button-quiet" onClick={onClear} type="button">
        Hapus riwayat diagnostik
      </button>
    </section>
  )
}
