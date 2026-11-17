import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUILT_IN_NOTIFICATION_SOUNDS,
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
  it.each(BUILT_IN_NOTIFICATION_SOUNDS)(
    'plays the generated WAV for $label through the media element',
    async (sound) => {
      const play = vi.fn(async () => {})
      const pause = vi.fn()
      let generatedBlob: Blob | undefined
      const createObjectUrl = vi.fn((blob: Blob) => {
        generatedBlob = blob
        return `blob:moodtask-${sound.id}-${createObjectUrl.mock.calls.length}`
      })
      const revokeObjectUrl = vi.fn()
      const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
        URL,
        'createObjectURL',
      )
      const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
        URL,
        'revokeObjectURL',
      )
      const listeners = new Map<string, EventListener[]>()
      let audioSource = ''
      class FakeAudio {
        preload = ''
        currentTime = 0
        play = play
        pause = pause
        addEventListener = vi.fn((type: string, listener: EventListener) => {
          const registered = listeners.get(type) ?? []
          registered.push(listener)
          listeners.set(type, registered)
        })
        removeEventListener = vi.fn()

        constructor(source: string) {
          audioSource = source
        }

        dispatch(type: string) {
          for (const listener of listeners.get(type) ?? []) {
            listener(new Event(type))
          }
        }
      }

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: createObjectUrl,
      })
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: revokeObjectUrl,
      })
      vi.stubGlobal('Audio', FakeAudio)
      try {
        const playback = playNotificationSound(sound.id)
        const blob = generatedBlob
        if (!blob) throw new Error('Expected a generated WAV blob.')
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const samples = new Int16Array(bytes.buffer, 44)

        expect(audioSource).toBe(`blob:moodtask-${sound.id}-1`)
        expect(blob.type).toBe('audio/wav')
        expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
        expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
        expect(samples.some((sample) => sample !== 0)).toBe(true)
        expect(play).toHaveBeenCalledOnce()

        const states: string[] = []
        playback.onStatus((state) => states.push(state))
        const ended = vi.fn()
        playback.onEnded(ended)
        playback.stop()
        expect(pause).toHaveBeenCalledOnce()
        expect(revokeObjectUrl).toHaveBeenCalledWith(`blob:moodtask-${sound.id}-1`)
        expect(states).toContain('stopped')
        expect(states).not.toContain('ended')
        expect(ended).not.toHaveBeenCalled()

        const endedPlayback = playNotificationSound(sound.id)
        const endedStates: string[] = []
        const onEnded = vi.fn()
        endedPlayback.onStatus((state) => endedStates.push(state))
        endedPlayback.onEnded(onEnded)
        await Promise.resolve()
        for (const listener of listeners.get('ended') ?? []) {
          listener(new Event('ended'))
        }
        expect(endedStates).toEqual(['started', 'ended'])
        expect(onEnded).toHaveBeenCalledOnce()
        expect(revokeObjectUrl).toHaveBeenCalledWith(`blob:moodtask-${sound.id}-2`)

        const failedPlayback = playNotificationSound(sound.id)
        const failedStates: string[] = []
        failedPlayback.onStatus((state) => failedStates.push(state))
        await Promise.resolve()
        for (const listener of listeners.get('error') ?? []) {
          listener(new Event('error'))
        }
        expect(failedStates).toEqual(['started', 'error'])
        expect(revokeObjectUrl).toHaveBeenCalledWith(`blob:moodtask-${sound.id}-3`)
      } finally {
        vi.unstubAllGlobals()
        if (originalCreateObjectUrl) {
          Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
        } else {
          Reflect.deleteProperty(URL, 'createObjectURL')
        }
        if (originalRevokeObjectUrl) {
          Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
        } else {
          Reflect.deleteProperty(URL, 'revokeObjectURL')
        }
      }
    },
  )

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
      removeEventListener = vi.fn()

      constructor() {
        playbackAudio = this as unknown as HTMLAudioElement
      }
    }
    vi.stubGlobal('Audio', FakeAudio)
    try {
      const result = playNotificationSound(
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

  it('reports a rejected play promise and releases a built-in WAV URL', async () => {
    const play = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('Autoplay blocked'), {
          name: 'NotAllowedError',
        }),
      ),
    )
    const revoked: string[] = []
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      'createObjectURL',
    )
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      'revokeObjectURL',
    )
    class FakeAudio {
      preload = ''
      currentTime = 0
      play = play
      pause = vi.fn()
      addEventListener = vi.fn()
      removeEventListener = vi.fn()

      constructor() {}
    }
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:moodtask-rejected'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn((url: string) => revoked.push(url)),
    })
    vi.stubGlobal('Audio', FakeAudio)
    try {
      const playback = playNotificationSound('momo-chime')
      const states: string[] = []
      const errors: Error[] = []
      playback.onStatus((state, error) => {
        states.push(state)
        if (error) errors.push(error)
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(states).toEqual(['error'])
      expect(errors[0]?.name).toBe('NotAllowedError')
      expect(revoked).toEqual(['blob:moodtask-rejected'])
    } finally {
      vi.unstubAllGlobals()
      if (originalCreateObjectUrl) {
        Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL')
      }
      if (originalRevokeObjectUrl) {
        Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
      } else {
        Reflect.deleteProperty(URL, 'revokeObjectURL')
      }
    }
  })

  it('releases the WAV URL if the media element cannot be constructed', () => {
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      'createObjectURL',
    )
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      'revokeObjectURL',
    )
    const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:moodtask-constructor-error'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    })
    vi.stubGlobal(
      'Audio',
      class {
        constructor() {
          throw new Error('Audio is unavailable')
        }
      },
    )
    try {
      expect(() => playNotificationSound('momo-chime')).toThrow(
        'Audio is unavailable',
      )
      expect(revoke).toHaveBeenCalledWith('blob:moodtask-constructor-error')
    } finally {
      vi.unstubAllGlobals()
      if (originalCreateObjectUrl) {
        Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL')
      }
      if (originalRevokeObjectUrl) {
        Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
      } else {
        Reflect.deleteProperty(URL, 'revokeObjectURL')
      }
    }
  })
})
