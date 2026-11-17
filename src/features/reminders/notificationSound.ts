export const BUILT_IN_NOTIFICATION_SOUNDS = [
  { id: 'momo-chime', label: 'Lonceng Momo', frequencies: [659, 880, 1_175] },
  { id: 'soft-bell', label: 'Lonceng lembut', frequencies: [784, 988] },
  { id: 'bright-pop', label: 'Nada ceria', frequencies: [1_047] },
] as const

export type BuiltInNotificationSoundId =
  (typeof BUILT_IN_NOTIFICATION_SOUNDS)[number]['id']
export type NotificationSoundId = BuiltInNotificationSoundId | 'custom'

export type NotificationSoundPreference = {
  soundId: NotificationSoundId
  muted: boolean
  objectPath: string | null
  fileName: string | null
}

export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundPreference = {
  soundId: 'momo-chime',
  muted: false,
  objectPath: null,
  fileName: null,
}

export const MAX_NOTIFICATION_SOUND_BYTES = 5 * 1024 * 1024
export const MAX_NOTIFICATION_SOUND_SECONDS = 30
export const NOTIFICATION_SOUND_BUCKET = 'moodtask-notification-sounds'

const acceptedAudioTypes: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
}

export type ValidatedNotificationSoundFile = {
  contentType: string
  extension: string
}

export async function validateNotificationSoundFile(
  file: File,
): Promise<ValidatedNotificationSoundFile> {
  if (file.size <= 0) throw new Error('File suara kosong.')
  if (file.size > MAX_NOTIFICATION_SOUND_BYTES) {
    throw new Error('Ukuran suara maksimal 5 MiB.')
  }
  const extension = acceptedAudioTypes[file.type.toLowerCase()]
  if (!extension) {
    throw new Error(
      'Format tidak didukung. Pilih MP3, WAV, OGG, M4A/AAC, WebM, atau MP4.',
    )
  }
  const contentType =
    file.type === 'video/mp4'
      ? 'audio/mp4'
      : file.type === 'audio/x-wav'
        ? 'audio/wav'
        : file.type
  const audioElement = document.createElement('audio')
  if (!audioElement.canPlayType(contentType)) {
    throw new Error(
      'Browser ini tidak mendukung pemutaran format audio tersebut.',
    )
  }
  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) {
    throw new Error('Browser ini tidak dapat memvalidasi file suara unggahan.')
  }

  const context = new AudioContextConstructor()
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new Error(
      'Audio tidak valid atau codec-nya tidak didukung browser. File MP4 harus memiliki track audio.',
    )
  } finally {
    await context.close().catch(() => undefined)
  }
  if (decoded.length === 0 || decoded.numberOfChannels === 0) {
    throw new Error('File ini tidak berisi audio yang dapat diputar.')
  }
  if (decoded.duration > MAX_NOTIFICATION_SOUND_SECONDS) {
    throw new Error('Durasi suara maksimal 30 detik.')
  }
  return { contentType, extension }
}

export type SoundPlayback = {
  stop: () => void
  onEnded: (callback: () => void) => void
  onStatus: (callback: (status: SoundPlaybackState, error?: Error) => void) => void
}

export type SoundPlaybackState = 'started' | 'ended' | 'error' | 'stopped'

export type NotificationSoundLoadCallbacks = {
  onCustomSourceLoaded?: () => void
  onCustomSourceError?: () => void
}

function createBuiltInWave(sound: (typeof BUILT_IN_NOTIFICATION_SOUNDS)[number]) {
  const sampleRate = 44_100
  const toneDuration = 0.16
  const toneSpacing = 0.12
  const duration =
    (sound.frequencies.length - 1) * toneSpacing + toneDuration
  const sampleCount = Math.ceil(duration * sampleRate)
  const dataSize = sampleCount * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const time = sample / sampleRate
    let value = 0
    for (const [index, frequency] of sound.frequencies.entries()) {
      const localTime = time - index * toneSpacing
      if (localTime < 0 || localTime >= toneDuration) continue
      const attack = Math.min(1, localTime / 0.015)
      const decayProgress = Math.max(
        0,
        (localTime - 0.015) / (toneDuration - 0.015),
      )
      const decay = Math.exp(Math.log(0.000625) * decayProgress)
      value +=
        Math.sin(2 * Math.PI * frequency * localTime) * 0.16 * attack * decay
    }
    view.setInt16(
      44 + sample * 2,
      Math.round(Math.max(-1, Math.min(1, value)) * 32_767),
      true,
    )
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function playAudioElement(
  audio: HTMLAudioElement,
  ownedObjectUrl?: string,
): SoundPlayback {
  let released = false
  let terminal = false
  let currentState: SoundPlaybackState | null = null
  let endedCallback: (() => void) | null = null
  const callbacks = new Set<
    (status: SoundPlaybackState, error?: Error) => void
  >()
  const notify = (state: SoundPlaybackState, error?: Error) => {
    currentState = state
    for (const callback of callbacks) callback(state, error)
  }
  const releaseObjectUrl = () => {
    if (released || !ownedObjectUrl) return
    released = true
    URL.revokeObjectURL(ownedObjectUrl)
  }
  const removeMediaListeners = () => {
    audio.removeEventListener('ended', onEnded)
    audio.removeEventListener('error', onError)
  }
  const onEnded = () => {
    if (terminal) return
    terminal = true
    removeMediaListeners()
    releaseObjectUrl()
    notify('ended')
    endedCallback?.()
  }
  const onError = () => {
    if (terminal) return
    terminal = true
    removeMediaListeners()
    releaseObjectUrl()
    notify('error', new Error('Audio source could not be decoded or played.'))
  }
  audio.addEventListener(
    'ended',
    onEnded,
    { once: true },
  )
  audio.addEventListener('error', onError, { once: true })
  const playback: SoundPlayback = {
    stop: () => {
      if (terminal) return
      terminal = true
      removeMediaListeners()
      audio.pause()
      audio.currentTime = 0
      releaseObjectUrl()
      notify('stopped')
    },
    onEnded: (callback) => {
      endedCallback = callback
      if (currentState === 'ended') callback()
    },
    onStatus: (callback) => {
      callbacks.add(callback)
      if (currentState) callback(currentState)
    },
  }

  let playPromise: Promise<void>
  try {
    playPromise = audio.play()
  } catch (error) {
    terminal = true
    removeMediaListeners()
    releaseObjectUrl()
    notify(
      'error',
      error instanceof Error ? error : new Error('Audio playback failed.'),
    )
    return playback
  }
  void playPromise.then(
    () => {
      if (!terminal) notify('started')
    },
    (error: unknown) => {
      if (terminal) return
      terminal = true
      removeMediaListeners()
      releaseObjectUrl()
      notify(
        'error',
        error instanceof Error ? error : new Error('Audio playback failed.'),
      )
    },
  )
  return playback
}

export function playNotificationSound(
  soundId: NotificationSoundId,
  uploadedSoundUrl: string | null = null,
  loadCallbacks: NotificationSoundLoadCallbacks = {},
): SoundPlayback {
  if (soundId === 'custom') {
    if (!uploadedSoundUrl) {
      throw new Error('File suara unggahan belum tersedia.')
    }
    const audio = new Audio(uploadedSoundUrl)
    audio.preload = 'auto'
    audio.addEventListener(
      'loadeddata',
      () => loadCallbacks.onCustomSourceLoaded?.(),
      { once: true },
    )
    audio.addEventListener(
      'error',
      () => loadCallbacks.onCustomSourceError?.(),
      { once: true },
    )
    return playAudioElement(audio)
  }

  const sound = BUILT_IN_NOTIFICATION_SOUNDS.find((item) => item.id === soundId)
  if (!sound) throw new Error('Pilihan suara tidak dikenal.')
  const objectUrl = URL.createObjectURL(createBuiltInWave(sound))
  try {
    const audio = new Audio(objectUrl)
    audio.preload = 'auto'
    return playAudioElement(audio, objectUrl)
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}
