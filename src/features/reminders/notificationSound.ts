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
}

export async function playNotificationSound(
  soundId: NotificationSoundId,
  uploadedSoundUrl: string | null = null,
): Promise<SoundPlayback> {
  if (soundId === 'custom') {
    if (!uploadedSoundUrl) {
      throw new Error('File suara unggahan belum tersedia.')
    }
    const audio = new Audio(uploadedSoundUrl)
    audio.preload = 'auto'
    await audio.play()
    return {
      stop: () => {
        audio.pause()
        audio.currentTime = 0
      },
      onEnded: (callback) => {
        audio.addEventListener('ended', callback, { once: true })
      },
    }
  }

  const sound = BUILT_IN_NOTIFICATION_SOUNDS.find((item) => item.id === soundId)
  if (!sound) throw new Error('Pilihan suara tidak dikenal.')
  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) {
    throw new Error('Browser ini tidak mendukung pratinjau suara bawaan.')
  }
  const context = new AudioContextConstructor()
  await context.resume()
  const startAt = context.currentTime + 0.02
  const toneDuration = 0.16
  const spacing = 0.12
  let remainingTones = sound.frequencies.length
  let onEnded: (() => void) | null = null
  for (const [index, frequency] of sound.frequencies.entries()) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const toneStart = startAt + index * spacing
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, toneStart)
    gain.gain.exponentialRampToValueAtTime(0.16, toneStart + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + toneDuration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => {
      remainingTones -= 1
      if (remainingTones === 0) {
        onEnded?.()
        void context.close()
      }
    }
    oscillator.start(toneStart)
    oscillator.stop(toneStart + toneDuration)
  }
  return {
    stop: () => {
      void context.close()
    },
    onEnded: (callback) => {
      onEnded = callback
    },
  }
}
