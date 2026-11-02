import { useRef, useState } from 'react'
import { BellRing, Check, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import type { ReminderSettingsValue } from './ReminderSettingsContext'
import {
  BUILT_IN_NOTIFICATION_SOUNDS,
  DEFAULT_NOTIFICATION_SOUND,
  playNotificationSound,
  validateNotificationSoundFile,
  type NotificationSoundPreference,
  type SoundPlayback,
  type ValidatedNotificationSoundFile,
} from './notificationSound'

type SelectedFile = {
  file: File
  validation: ValidatedNotificationSoundFile
}

export default function NotificationSoundSettings({
  settings,
}: {
  settings: ReminderSettingsValue
}) {
  const [draft, setDraft] = useState(settings.soundPreference)
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [checkingFile, setCheckingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const playback = useRef<SoundPlayback | null>(null)
  const temporaryUrl = useRef<string | null>(null)

  function stopPreview() {
    playback.current?.stop()
    playback.current = null
    if (temporaryUrl.current) URL.revokeObjectURL(temporaryUrl.current)
    temporaryUrl.current = null
    setPreviewing(false)
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setError('')
    setMessage('')
    setCheckingFile(true)
    try {
      const validation = await validateNotificationSoundFile(file)
      stopPreview()
      setSelectedFile({ file, validation })
      setDraft((current) => ({
        ...current,
        soundId: 'custom',
        objectPath: null,
        fileName: file.name.slice(0, 255),
      }))
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'File suara tidak didukung atau tidak dapat diputar.',
      )
      if (fileInput.current) fileInput.current.value = ''
    } finally {
      setCheckingFile(false)
    }
  }

  async function listen() {
    setError('')
    if (previewing) {
      stopPreview()
      return
    }
    try {
      let soundUrl: string | null = null
      if (draft.soundId === 'custom') {
        if (selectedFile) {
          temporaryUrl.current = URL.createObjectURL(selectedFile.file)
          soundUrl = temporaryUrl.current
        } else if (draft.objectPath) {
          soundUrl = await settings.getNotificationSoundUrl(draft.objectPath)
        } else {
          throw new Error('Pilih file suara terlebih dahulu.')
        }
      }
      playback.current = await playNotificationSound(draft.soundId, soundUrl)
      playback.current.onEnded(() => {
        playback.current = null
        if (temporaryUrl.current) URL.revokeObjectURL(temporaryUrl.current)
        temporaryUrl.current = null
        setPreviewing(false)
      })
      setPreviewing(true)
    } catch (caught) {
      if (temporaryUrl.current) URL.revokeObjectURL(temporaryUrl.current)
      temporaryUrl.current = null
      playback.current = null
      setError(
        caught instanceof Error
          ? caught.message
          : 'Pratinjau suara belum dapat diputar. Periksa izin audio browser.',
      )
      setPreviewing(false)
    }
  }

  async function save() {
    if (saving || checkingFile) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      if (draft.soundId === 'custom' && selectedFile) {
        const savedPreference = await settings.uploadAndSaveNotificationSound(
          selectedFile.file,
          selectedFile.validation.contentType,
          selectedFile.validation.extension,
          selectedFile.file.name,
          draft.muted,
        )
        setDraft(savedPreference)
        setSelectedFile(null)
        if (fileInput.current) fileInput.current.value = ''
      } else {
        await settings.saveNotificationSound(draft)
        if (draft.soundId !== 'custom') {
          setSelectedFile(null)
          if (fileInput.current) fileInput.current.value = ''
        }
      }
      setMessage('Pengaturan suara notifikasi berhasil disimpan.')
    } catch (caught) {
      stopPreview()
      setDraft(settings.soundPreference)
      setSelectedFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setError(
        caught instanceof Error
          ? caught.message
          : 'Pengaturan suara belum dapat disimpan. Pilihan sebelumnya tetap digunakan.',
      )
    } finally {
      setSaving(false)
    }
  }

  function chooseBuiltIn(soundId: NotificationSoundPreference['soundId']) {
    if (soundId === 'custom') return
    stopPreview()
    setDraft((current) => ({
      ...current,
      soundId,
      objectPath: null,
      fileName: null,
    }))
    setError('')
    setMessage('')
  }

  function returnToBuiltIn() {
    stopPreview()
    setDraft({
      ...DEFAULT_NOTIFICATION_SOUND,
      muted: draft.muted,
    })
    setSelectedFile(null)
    if (fileInput.current) fileInput.current.value = ''
    setError('')
    setMessage('')
  }

  function chooseCustom() {
    if (selectedFile) {
      setDraft((current) => ({
        ...current,
        soundId: 'custom',
        objectPath: null,
        fileName: selectedFile.file.name.slice(0, 255),
      }))
    } else if (settings.soundPreference.soundId === 'custom') {
      setDraft(settings.soundPreference)
    }
    setError('')
    setMessage('')
  }

  const fileName =
    selectedFile?.file.name ??
    (draft.soundId === 'custom' ? draft.fileName : null)

  return (
    <section
      className="sound-settings-panel"
      aria-labelledby="sound-settings-title"
    >
      <div className="sound-settings-header">
        <span className="push-settings-icon" aria-hidden="true">
          <BellRing size={20} />
        </span>
        <div>
          <span className="section-kicker">PREFERENSI AUDIO</span>
          <h2 id="sound-settings-title">Suara notifikasi</h2>
          <p>
            Suara diputar saat pengingat push diterima ketika MoodTask terbuka.
          </p>
        </div>
      </div>

      <fieldset
        className="sound-choice-list"
        disabled={settings.soundLoading || saving}
      >
        <legend>Pilih suara bawaan</legend>
        {BUILT_IN_NOTIFICATION_SOUNDS.map((sound) => (
          <label className="sound-choice" key={sound.id}>
            <input
              type="radio"
              name="notification-sound"
              value={sound.id}
              checked={draft.soundId === sound.id}
              onChange={() => chooseBuiltIn(sound.id)}
            />
            <span>{sound.label}</span>
          </label>
        ))}
        {(settings.soundPreference.soundId === 'custom' || selectedFile) && (
          <label className="sound-choice">
            <input
              type="radio"
              name="notification-sound"
              value="custom"
              checked={draft.soundId === 'custom'}
              onChange={chooseCustom}
            />
            <span>Suara unggahan</span>
          </label>
        )}
      </fieldset>

      <div className="sound-upload-control">
        <label htmlFor="notification-sound-file">Unggah suara sendiri</label>
        <input
          ref={fileInput}
          id="notification-sound-file"
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/aac,audio/webm,video/mp4,.mp3,.wav,.ogg,.m4a,.aac,.webm,.mp4"
          disabled={!settings.repositoryAvailable || saving || checkingFile}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
          aria-describedby="notification-sound-file-help"
        />
        <p id="notification-sound-file-help">
          Maksimal 5 MiB dan 30 detik. Format: MP3, WAV, OGG, M4A/AAC, WebM,
          atau MP4 yang memiliki track audio dan dapat didekode browser.
        </p>
        {fileName && (
          <p className="sound-file-name" title={fileName}>
            File dipilih: <strong>{fileName}</strong>
          </p>
        )}
        {!settings.repositoryAvailable && (
          <p className="sound-upload-note">
            Masuk ke akun untuk menyimpan unggahan suara. Suara bawaan tetap
            dapat disimpan pada perangkat ini.
          </p>
        )}
        {checkingFile && <p role="status">Memeriksa file audio…</p>}
      </div>

      <label className="sound-mute-toggle">
        <input
          type="checkbox"
          checked={draft.muted}
          disabled={settings.soundLoading || saving}
          onChange={(event) =>
            setDraft((current) => ({ ...current, muted: event.target.checked }))
          }
        />
        <span>
          {draft.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </span>
        Bisukan suara notifikasi
      </label>

      <div className="sound-settings-actions">
        <button
          type="button"
          className="button button-quiet"
          disabled={settings.soundLoading || saving || checkingFile}
          onClick={() => void listen()}
        >
          <Volume2 size={16} />
          {previewing ? 'Hentikan pratinjau' : 'Dengarkan'}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={settings.soundLoading || saving || checkingFile}
          onClick={() => void save()}
        >
          <Check size={16} /> {saving ? 'Menyimpan…' : 'Simpan pilihan'}
        </button>
        {draft.soundId === 'custom' && (
          <button
            type="button"
            className="button button-quiet sound-reset-button"
            disabled={settings.soundLoading || saving || checkingFile}
            onClick={returnToBuiltIn}
          >
            <RotateCcw size={15} /> Kembali ke suara bawaan
          </button>
        )}
      </div>

      {(error || settings.soundError) && (
        <p className="sound-feedback is-error" role="alert">
          {error || settings.soundError}
        </p>
      )}
      {message && (
        <p className="sound-feedback" role="status">
          {message}
        </p>
      )}
      <p className="sound-delivery-note">
        Browser dapat menahan autoplay. Tekan “Dengarkan” untuk pratinjau dan
        mengizinkan audio. Suara tidak dijamin berbunyi ketika Chrome ditutup.
      </p>
    </section>
  )
}
