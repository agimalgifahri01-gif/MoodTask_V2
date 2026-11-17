import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderRepository } from './ReminderRepository'
import { useReminderSettings } from './ReminderSettingsContext'
import { ReminderSettingsProvider } from './ReminderSettingsProvider'
import {
  BUILT_IN_NOTIFICATION_SOUNDS,
  DEFAULT_NOTIFICATION_SOUND,
  type SoundPlayback,
} from './notificationSound'

const {
  playSound,
  listenNative,
  isTauri,
  invokeNative,
  playbackStatusHandlers,
  playbackStops,
} = vi.hoisted(() => ({
  playSound: vi.fn(),
  listenNative: vi.fn(),
  isTauri: vi.fn(() => true),
  invokeNative: vi.fn(async () => undefined),
  playbackStatusHandlers: [] as Array<Parameters<SoundPlayback['onStatus']>[0]>,
  playbackStops: [] as Array<ReturnType<typeof vi.fn>>,
}))

vi.mock('@tauri-apps/api/core', () => ({
  isTauri,
  invoke: invokeNative,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenNative }))

vi.mock('./notificationSound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notificationSound')>()
  return { ...actual, playNotificationSound: playSound }
})

function makeRepository(
  muted = false,
  customSound = false,
  builtInSoundId: (typeof BUILT_IN_NOTIFICATION_SOUNDS)[number]['id'] = 'momo-chime',
): ReminderRepository {
  return {
    list: async () => [],
    saveReminder: async () => {
      throw new Error('Not used in sound setting tests')
    },
    removeReminder: async () => {},
    getPushSubscriptionOrigin: async () => null,
    savePushSubscription: async () => {},
    removePushSubscription: async () => {},
    getNotificationSoundPreference: async () => ({
      ...DEFAULT_NOTIFICATION_SOUND,
      ...(customSound
        ? {
            soundId: 'custom' as const,
            objectPath: 'user-a/sound.mp3',
            fileName: 'sound.mp3',
          }
        : {}),
      ...(!customSound ? { soundId: builtInSoundId } : {}),
      muted,
    }),
    saveNotificationSoundPreference: async () => {},
    uploadNotificationSound: async () => 'user-a/sound.mp3',
    getNotificationSoundUrl: async () => 'https://storage.example/signed',
    removeNotificationSound: async () => {},
  }
}

function Consumer() {
  const settings = useReminderSettings()
  return (
    <>
      <p>{settings.soundLoading ? 'Memuat' : 'Siap'}</p>
      <output data-testid="sound-diagnostics">
        {JSON.stringify(settings.nativeSoundDiagnostics)}
      </output>
      <button onClick={settings.clearNativeSoundDiagnostics}>
        Reset diagnostics
      </button>
      <button
        onClick={() =>
          void settings.saveNotificationSound({
            ...settings.soundPreference,
            soundId: 'soft-bell',
            objectPath: null,
            fileName: null,
          })
        }
      >
        Change sound preference
      </button>
      <button
        onClick={() =>
          void settings.saveNotificationSound({
            ...settings.soundPreference,
            muted: true,
          })
        }
      >
        Mute sound
      </button>
    </>
  )
}

describe('ReminderSettingsProvider notification sound delivery', () => {
  let serviceWorker: EventTarget
  let originalServiceWorker: PropertyDescriptor | undefined
  let nativeUnlisten: () => void
  let nativeHandler:
    ((event: { payload: { eventId: string } }) => void) | undefined

  beforeEach(() => {
    playSound.mockClear()
    invokeNative.mockClear()
    playbackStatusHandlers.length = 0
    playbackStops.length = 0
    playSound.mockImplementation((_soundId, _url, callbacks) => {
      callbacks?.onCustomSourceLoaded?.()
      const stop = vi.fn()
      playbackStops.push(stop)
      return {
        stop,
        onEnded: vi.fn(),
        onStatus: (handler: Parameters<SoundPlayback['onStatus']>[0]) => {
          playbackStatusHandlers.push(handler)
          handler('started')
        },
      }
    })
    isTauri.mockReturnValue(true)
    listenNative.mockReset()
    nativeHandler = undefined
    nativeUnlisten = vi.fn()
    listenNative.mockImplementation(async (_name, handler) => {
      nativeHandler = handler
      return nativeUnlisten
    })
    serviceWorker = new EventTarget()
    originalServiceWorker = Object.getOwnPropertyDescriptor(
      navigator,
      'serviceWorker',
    )
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    })
  })

  afterEach(() => {
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }
  })

  it('plays once for a service worker reminder message with a duplicate event tag', async () => {
    render(
      <ReminderSettingsProvider repository={makeRepository()}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')

    await act(async () => {
      for (let index = 0; index < 2; index += 1) {
        serviceWorker.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'MOODTASK_REMINDER_RECEIVED',
              eventId: 'moodtask-task-reminder-deadline',
            },
          }),
        )
      }
    })

    expect(playSound).toHaveBeenCalledOnce()
    expect(playSound).toHaveBeenCalledWith('momo-chime', null, undefined)
  })

  it('plays the persisted custom sound once for a native Tauri reminder event', async () => {
    const view = render(
      <ReminderSettingsProvider repository={makeRepository(false, true)}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')

    await act(async () => {
      nativeHandler?.({ payload: { eventId: 'native-reminder-unique-1' } })
      nativeHandler?.({ payload: { eventId: 'native-reminder-unique-1' } })
    })

    expect(playSound).toHaveBeenCalledOnce()
    expect(playSound).toHaveBeenCalledWith(
      'custom',
      'https://storage.example/signed',
      expect.objectContaining({
        onCustomSourceLoaded: expect.any(Function),
        onCustomSourceError: expect.any(Function),
      }),
    )
    expect(listenNative).toHaveBeenCalledWith(
      'moodtask://native-reminder-received',
      expect.any(Function),
    )
    expect(listenNative).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(invokeNative).toHaveBeenCalledWith(
        'acknowledge_native_reminder_event',
        { eventId: 'native-reminder-unique-1' },
      )
    })
    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({
      listenerActive: true,
      eventReceived: true,
      audioUrlStatus: 'success',
      playbackStatus: 'started',
      error: null,
    })
    await act(async () => {
      screen.getByRole('button', { name: 'Reset diagnostics' }).click()
    })
    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({
      listenerActive: true,
      eventReceived: false,
      audioUrlStatus: 'unknown',
      playbackStatus: 'unknown',
      error: null,
    })
    view.unmount()
    expect(nativeUnlisten).toHaveBeenCalledOnce()
  })

  it.each(BUILT_IN_NOTIFICATION_SOUNDS)(
    'routes native reminders to the saved built-in sound $id',
    async (sound) => {
      render(
        <ReminderSettingsProvider
          repository={makeRepository(false, false, sound.id)}
        >
          <Consumer />
        </ReminderSettingsProvider>,
      )
      await screen.findByText('Siap')

      await act(async () => {
        nativeHandler?.({ payload: { eventId: `native-${sound.id}` } })
      })

      expect(playSound).toHaveBeenCalledWith(sound.id, null, undefined)
    },
  )

  it('logs autoplay rejection from native reminder playback without logging sound URLs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    playSound.mockImplementationOnce(() => ({
      stop: vi.fn(),
      onEnded: vi.fn(),
      onStatus: (handler: Parameters<SoundPlayback['onStatus']>[0]) =>
        handler(
          'error',
          Object.assign(new Error('Playback blocked'), {
            name: 'NotAllowedError',
          }),
        ),
    }))
    render(
      <ReminderSettingsProvider repository={makeRepository(false, true)}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')

    await act(async () => {
      nativeHandler?.({
        payload: { eventId: 'native-reminder-autoplay-error' },
      })
    })

    expect(warn).toHaveBeenCalledWith(
      '[MoodTask] Reminder sound media error.',
      expect.objectContaining({
        stage: 'audio-play',
        errorName: 'NotAllowedError',
        timestamp_epoch_ms: expect.any(Number),
        trace_id: expect.any(String),
      }),
    )
    expect(warn.mock.calls.flat().join(' ')).not.toContain(
      'https://storage.example/signed',
    )
    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({
      eventReceived: true,
      audioUrlStatus: 'unknown',
      playbackStatus: 'failure',
      error: expect.stringContaining('memblokir pemutaran otomatis'),
    })
    warn.mockRestore()
  })

  it('shows the capability reason when Tauri denies event listener registration', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    listenNative.mockRejectedValueOnce(
      new Error('Permission denied for plugin:event|listen'),
    )
    render(
      <ReminderSettingsProvider repository={makeRepository()}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')

    await waitFor(() => {
      expect(
        JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
      ).toMatchObject({
        listenerActive: false,
        error: expect.stringContaining('core:event:allow-listen'),
      })
    })
    expect(error).toHaveBeenCalledWith(
      '[MoodTask] Native reminder listener registration failed.',
      expect.objectContaining({ errorName: 'Error' }),
    )
    error.mockRestore()
  })

  it('does not play when the persisted preference is muted', async () => {
    render(
      <ReminderSettingsProvider repository={makeRepository(true)}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')

    act(() => {
      serviceWorker.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'MOODTASK_REMINDER_RECEIVED',
            eventId: 'muted-event',
          },
        }),
      )
    })

    expect(playSound).not.toHaveBeenCalled()
  })

  it('stops the earlier sound when two different reminders arrive together', async () => {
    render(
      <ReminderSettingsProvider repository={makeRepository()}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')

    await act(async () => {
      nativeHandler?.({ payload: { eventId: 'close-reminder-a' } })
      nativeHandler?.({ payload: { eventId: 'close-reminder-b' } })
    })

    expect(playSound).toHaveBeenCalledTimes(2)
    expect(playbackStops[0]).toHaveBeenCalledOnce()
    expect(playbackStops[1]).not.toHaveBeenCalled()
    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({ playbackStatus: 'started', error: null })
  })

  it('ignores an older custom-sound URL that resolves after a newer reminder', async () => {
    const repository = makeRepository(false, true)
    const deferredUrls: Array<(url: string) => void> = []
    repository.getNotificationSoundUrl = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          deferredUrls.push(resolve)
        }),
    )
    render(
      <ReminderSettingsProvider repository={repository}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')

    await act(async () => {
      nativeHandler?.({ payload: { eventId: 'custom-reminder-old' } })
      nativeHandler?.({ payload: { eventId: 'custom-reminder-new' } })
    })
    expect(deferredUrls).toHaveLength(2)

    await act(async () => {
      deferredUrls[1]?.('https://storage.example/newer-signed-url')
      await Promise.resolve()
    })
    await act(async () => {
      deferredUrls[0]?.('https://storage.example/older-signed-url')
      await Promise.resolve()
    })

    expect(playSound).toHaveBeenCalledOnce()
    expect(playSound).toHaveBeenCalledWith(
      'custom',
      'https://storage.example/newer-signed-url',
      expect.any(Object),
    )
  })

  it('does not stop current audio when the sound preference changes', async () => {
    render(
      <ReminderSettingsProvider repository={makeRepository()}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')
    await act(async () => {
      nativeHandler?.({
        payload: { eventId: 'preference-change-active-audio' },
      })
    })

    await act(async () => {
      screen.getByRole('button', { name: 'Change sound preference' }).click()
    })

    expect(playbackStops[0]).not.toHaveBeenCalled()
  })

  it('stops current audio immediately when mute is enabled', async () => {
    render(
      <ReminderSettingsProvider repository={makeRepository()}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')
    await act(async () => {
      nativeHandler?.({ payload: { eventId: 'mute-active-audio' } })
    })

    await act(async () => {
      screen.getByRole('button', { name: 'Mute sound' }).click()
    })

    expect(playbackStops[0]).toHaveBeenCalledOnce()
    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({ playbackStatus: 'stopped' })
  })

  it('records an error that occurs after playback has started', async () => {
    render(
      <ReminderSettingsProvider repository={makeRepository()}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')
    await act(async () => {
      nativeHandler?.({ payload: { eventId: 'media-error-after-start' } })
    })

    await act(async () => {
      playbackStatusHandlers[0]?.('error', new Error('Decoder failed'))
    })

    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({
      playbackStatus: 'failure',
      error: expect.stringContaining('Error'),
    })
  })

  it('records completion only after the audio ended event', async () => {
    render(
      <ReminderSettingsProvider repository={makeRepository()}>
        <Consumer />
      </ReminderSettingsProvider>,
    )
    await screen.findByText('Siap')
    await act(async () => {
      nativeHandler?.({ payload: { eventId: 'playback-ended' } })
    })
    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({ playbackStatus: 'started' })

    await act(async () => {
      playbackStatusHandlers[0]?.('ended')
    })
    expect(
      JSON.parse(screen.getByTestId('sound-diagnostics').textContent ?? ''),
    ).toMatchObject({ playbackStatus: 'ended' })
  })
})
