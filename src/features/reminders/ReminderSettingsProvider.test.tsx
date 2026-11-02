import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderRepository } from './ReminderRepository'
import { useReminderSettings } from './ReminderSettingsContext'
import { ReminderSettingsProvider } from './ReminderSettingsProvider'
import { DEFAULT_NOTIFICATION_SOUND } from './notificationSound'

const { playSound } = vi.hoisted(() => ({
  playSound: vi.fn(async () => ({ stop: vi.fn(), onEnded: vi.fn() })),
}))

vi.mock('./notificationSound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notificationSound')>()
  return { ...actual, playNotificationSound: playSound }
})

function makeRepository(muted = false): ReminderRepository {
  return {
    list: async () => [],
    saveReminder: async () => {
      throw new Error('Not used in sound setting tests')
    },
    removeReminder: async () => {},
    savePushSubscription: async () => {},
    removePushSubscription: async () => {},
    getNotificationSoundPreference: async () => ({
      ...DEFAULT_NOTIFICATION_SOUND,
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
  return <p>{settings.soundLoading ? 'Memuat' : 'Siap'}</p>
}

describe('ReminderSettingsProvider notification sound delivery', () => {
  let serviceWorker: EventTarget
  let originalServiceWorker: PropertyDescriptor | undefined

  beforeEach(() => {
    playSound.mockClear()
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

    act(() => {
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
    expect(playSound).toHaveBeenCalledWith('momo-chime', null)
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
})
