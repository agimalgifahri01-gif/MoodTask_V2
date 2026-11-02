import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_NOTIFICATION_SOUND_BYTES,
  playNotificationSound,
  validateNotificationSoundFile,
} from './notificationSound'

class MockAudioContext {
  static decodedDuration = 2
  decodeAudioData = vi.fn(async () => ({
    length: 10,
    numberOfChannels: 1,
    duration: MockAudioContext.decodedDuration,
  }))
  close = vi.fn(async () => {})
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue(
    'probably',
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('notification sound uploads', () => {
  it('accepts decodable audio files and normalizes MP4 audio MIME type', async () => {
    const original = window.AudioContext
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    })
    try {
      await expect(
        validateNotificationSoundFile(
          new File(['audio'], 'voice.mp4', { type: 'video/mp4' }),
        ),
      ).resolves.toEqual({ contentType: 'audio/mp4', extension: 'mp4' })
    } finally {
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: original,
      })
    }
  })

  it('rejects an MP4 file with no decodable audio track', async () => {
    const original = window.AudioContext
    class NoAudioContext extends MockAudioContext {
      override decodeAudioData = vi.fn(async () => {
        throw new Error('No audio track')
      })
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: NoAudioContext,
    })
    try {
      await expect(
        validateNotificationSoundFile(
          new File(['video'], 'silent.mp4', { type: 'video/mp4' }),
        ),
      ).rejects.toThrow('File MP4 harus memiliki track audio')
    } finally {
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: original,
      })
    }
  })

  it('rejects unsupported, oversized, and overlong sound files', async () => {
    await expect(
      validateNotificationSoundFile(
        new File(['image'], 'picture.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow('Format tidak didukung')
    await expect(
      validateNotificationSoundFile(
        new File(
          [new Uint8Array(MAX_NOTIFICATION_SOUND_BYTES + 1)],
          'large.mp3',
          {
            type: 'audio/mpeg',
          },
        ),
      ),
    ).rejects.toThrow('maksimal 5 MiB')

    const original = window.AudioContext
    MockAudioContext.decodedDuration = 31
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    })
    try {
      await expect(
        validateNotificationSoundFile(
          new File(['audio'], 'long.mp3', { type: 'audio/mpeg' }),
        ),
      ).rejects.toThrow('Durasi suara maksimal')
    } finally {
      MockAudioContext.decodedDuration = 2
      Object.defineProperty(window, 'AudioContext', {
        configurable: true,
        value: original,
      })
    }
  })
})

describe('notification sound preview', () => {
  it('plays a custom file and exposes a stop control', async () => {
    const play = vi.fn(async () => {})
    const pause = vi.fn()
    const original = globalThis.Audio
    let playbackAudio: HTMLAudioElement | undefined
    class FakeAudio {
      preload = ''
      currentTime = 3
      play = play
      pause = pause
      addEventListener = vi.fn()

      constructor() {
        playbackAudio = this as unknown as HTMLAudioElement
      }
    }
    vi.stubGlobal('Audio', FakeAudio)
    try {
      const result = await playNotificationSound(
        'custom',
        'blob:http://localhost/custom-audio',
      )
      expect(play).toHaveBeenCalledOnce()
      result.stop()
      expect(pause).toHaveBeenCalledOnce()
      expect(playbackAudio?.currentTime).toBe(0)
    } finally {
      vi.stubGlobal('Audio', original)
    }
  })
})
