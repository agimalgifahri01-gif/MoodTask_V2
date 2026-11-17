import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ReminderRepository } from './ReminderRepository'
import {
  getCurrentBrowserPushSubscription,
  getCurrentPushCapability,
  requestBrowserPushSubscription,
  type PushCapability,
} from './browserPush'
import type { PushSubscriptionData, TaskReminder } from './model'
import { validateReminderOffset } from './model'
import { reminderTraceId } from './reminderTrace'
import type { Task } from '../tasks/domain'
import {
  ReminderSettingsContext,
  type NativeSoundDiagnostics,
} from './ReminderSettingsContext'
import { isCanonicalPushOrigin } from './pushOrigins'
import { acknowledgeNativeReminderEvent } from './nativeReminder'
import {
  DEFAULT_NOTIFICATION_SOUND,
  playNotificationSound,
  type NotificationSoundPreference,
  type SoundPlayback,
} from './notificationSound'

const localSoundPreferenceKey = 'moodtask.notification-sound.v1'
const emptyNativeSoundDiagnostics: NativeSoundDiagnostics = {
  listenerActive: false,
  eventReceived: false,
  audioUrlStatus: 'unknown',
  playbackStatus: 'unknown',
  error: null,
}

function reminderLogFields(eventId: string) {
  return { timestamp_epoch_ms: Date.now(), trace_id: reminderTraceId(eventId) }
}

function getNativeListenerErrorMessage(caught: unknown) {
  const detail =
    caught instanceof Error
      ? caught.message
      : typeof caught === 'string'
        ? caught
        : ''
  if (/permission|not allowed|denied|capability/i.test(detail)) {
    return 'Tauri menolak izin event. Capability jendela main harus mengizinkan core:event:allow-listen dan core:event:allow-unlisten.'
  }
  if (/plugin:event\|listen/i.test(detail)) {
    return 'Tauri gagal menjalankan plugin:event|listen. Periksa izin core:event:allow-listen pada capability jendela main.'
  }
  const safeDetail = detail.replace(/[\r\n\t]/g, ' ').slice(0, 180)
  return safeDetail
    ? `Listener event Tauri gagal diaktifkan: ${safeDetail}`
    : 'Listener event Tauri gagal diaktifkan karena alasan yang tidak diketahui.'
}

function readLocalSoundPreference(): NotificationSoundPreference {
  try {
    const value = localStorage.getItem(localSoundPreferenceKey)
    if (!value) return DEFAULT_NOTIFICATION_SOUND
    const parsed = JSON.parse(value) as Partial<NotificationSoundPreference>
    if (
      ['momo-chime', 'soft-bell', 'bright-pop'].includes(
        parsed.soundId ?? '',
      ) &&
      typeof parsed.muted === 'boolean' &&
      parsed.objectPath === null &&
      parsed.fileName === null
    ) {
      return parsed as NotificationSoundPreference
    }
  } catch {
    // Treat malformed browser preferences as the default without changing storage.
  }
  return DEFAULT_NOTIFICATION_SOUND
}

const publicVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export function ReminderSettingsProvider({
  children,
  repository,
}: {
  children: ReactNode
  repository: ReminderRepository | null
}) {
  const [reminders, setReminders] = useState<TaskReminder[]>([])
  const [loading, setLoading] = useState(repository !== null)
  const [error, setError] = useState<string | null>(null)
  const [pushCapability, setPushCapability] = useState<PushCapability>(() =>
    getCurrentPushCapability(publicVapidKey),
  )
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [soundPreference, setSoundPreference] =
    useState<NotificationSoundPreference>(() =>
      repository ? DEFAULT_NOTIFICATION_SOUND : readLocalSoundPreference(),
    )
  const soundPreferenceRef = useRef(soundPreference)
  const muteRequestedRef = useRef(false)
  const [soundLoading, setSoundLoading] = useState(repository !== null)
  const [soundSaving, setSoundSaving] = useState(false)
  const [soundError, setSoundError] = useState<string | null>(null)
  const [nativeSoundDiagnostics, setNativeSoundDiagnostics] =
    useState<NativeSoundDiagnostics>(() =>
      isTauri()
        ? emptyNativeSoundDiagnostics
        : {
            ...emptyNativeSoundDiagnostics,
            error:
              'Listener event hanya tersedia di aplikasi MoodTask Desktop.',
          },
    )
  const currentPlayback = useRef<SoundPlayback | null>(null)
  const playbackRequestId = useRef(0)
  const playedEventIds = useRef(new Set<string>())
  const pendingEventIds = useRef(new Set<string>())
  const clearNativeSoundDiagnostics = useCallback(() => {
    setNativeSoundDiagnostics((current) => ({
      ...emptyNativeSoundDiagnostics,
      listenerActive: current.listenerActive,
    }))
  }, [])
  const cancelCurrentPlayback = useCallback(() => {
    playbackRequestId.current += 1
    const playback = currentPlayback.current
    currentPlayback.current = null
    playback?.stop()
  }, [])
  const refresh = useCallback(async () => {
    if (!repository) {
      setReminders([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setReminders(await repository.list())
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : 'Jadwal pengingat belum dapat dimuat.'
      setError(message)
      throw new Error(message, { cause: caught })
    } finally {
      setLoading(false)
    }
  }, [repository])

  const [prevRepository, setPrevRepository] = useState(repository)
  if (repository !== prevRepository) {
    setPrevRepository(repository)
    setLoading(repository !== null)
    setError(null)
    setSoundLoading(repository !== null)
    setSoundError(null)
    if (!repository) {
      setReminders([])
      const localPreference = readLocalSoundPreference()
      setSoundPreference(localPreference)
    }
  }

  useEffect(() => {
    let active = true
    if (!repository) {
      soundPreferenceRef.current = readLocalSoundPreference()
    }
    if (repository) {
      void repository
        .list()
        .then((loaded) => {
          if (active) {
            setReminders(loaded)
            setPushCapability(getCurrentPushCapability(publicVapidKey))
          }
        })
        .catch((caught: unknown) => {
          if (!active) return
          setError(
            caught instanceof Error
              ? caught.message
              : 'Jadwal pengingat belum dapat dimuat.',
          )
        })
        .finally(() => {
          if (active) setLoading(false)
        })
      void repository
        .getNotificationSoundPreference()
        .then((preference) => {
          if (active) {
            const loadedPreference = preference ?? DEFAULT_NOTIFICATION_SOUND
            soundPreferenceRef.current = loadedPreference
            setSoundPreference(loadedPreference)
            setSoundError(null)
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setSoundError(
              caught instanceof Error
                ? caught.message
                : 'Preferensi suara belum dapat dimuat.',
            )
          }
        })
        .finally(() => {
          if (active) setSoundLoading(false)
        })
    }
    void getCurrentBrowserPushSubscription()
      .then((subscription) => {
        if (!active) return
        setPushSubscribed(subscription !== null)
        if (
          subscription &&
          repository &&
          isCanonicalPushOrigin(window.location.origin)
        ) {
          const serialized = subscription.toJSON()
          const p256dh = serialized.keys?.p256dh
          const auth = serialized.keys?.auth
          if (subscription.endpoint && p256dh && auth) {
            void repository
              .getPushSubscriptionOrigin(subscription.endpoint)
              .then((origin) => {
                if (origin === window.location.origin) return
                return repository.savePushSubscription({
                  endpoint: subscription.endpoint,
                  origin: window.location.origin,
                  expirationTime: subscription.expirationTime,
                  keys: { p256dh, auth },
                })
              })
              .catch(() => {
                if (active) {
                  setError(
                    'Langganan browser belum tersinkron ke akun. Periksa koneksi sebelum mengandalkan pengingat push.',
                  )
                }
              })
          }
        }
      })
      .catch(() => {
        if (active) setPushSubscribed(false)
      })
    return () => {
      active = false
    }
  }, [repository])

  const getNotificationSoundUrl = useCallback(
    async (path: string) => {
      if (!repository) {
        throw new Error('File suara unggahan memerlukan akun MoodTask.')
      }
      return repository.getNotificationSoundUrl(path)
    },
    [repository],
  )

  const saveNotificationSound = useCallback(
    async (preference: NotificationSoundPreference) => {
      if (preference.soundId === 'custom') {
        if (
          !repository ||
          !preference.objectPath ||
          preference.objectPath !== soundPreferenceRef.current.objectPath ||
          preference.fileName !== soundPreferenceRef.current.fileName
        ) {
          throw new Error('Unggah file suara sebelum memilih suara kustom.')
        }
      } else if (
        preference.objectPath !== null ||
        preference.fileName !== null
      ) {
        throw new Error('Pilih unggahan baru untuk menyimpan suara kustom.')
      }
      if (preference.muted) {
        muteRequestedRef.current = true
        cancelCurrentPlayback()
        setNativeSoundDiagnostics((current) => ({
          ...current,
          playbackStatus: 'stopped',
          error: 'Suara notifikasi sedang dimatikan.',
        }))
      }
      setSoundSaving(true)
      setSoundError(null)
      const previous = soundPreferenceRef.current
      try {
        if (repository) {
          await repository.saveNotificationSoundPreference(preference)
        } else {
          localStorage.setItem(
            localSoundPreferenceKey,
            JSON.stringify(preference),
          )
        }
        soundPreferenceRef.current = preference
        muteRequestedRef.current = false
        setSoundPreference(preference)
        if (
          previous.soundId === 'custom' &&
          previous.objectPath &&
          previous.objectPath !== preference.objectPath &&
          repository
        ) {
          try {
            await repository.removeNotificationSound(previous.objectPath)
          } catch {
            setSoundError(
              'Pilihan suara tersimpan, tetapi file unggahan sebelumnya belum terhapus.',
            )
          }
        }
      } catch (caught) {
        soundPreferenceRef.current = previous
        muteRequestedRef.current = false
        const message =
          caught instanceof Error
            ? caught.message
            : 'Pilihan suara belum dapat disimpan.'
        const feedback = `Pilihan suara sebelumnya tetap digunakan. ${message}`
        setSoundError(feedback)
        throw new Error(feedback, { cause: caught })
      } finally {
        setSoundSaving(false)
      }
    },
    [cancelCurrentPlayback, repository],
  )

  const uploadAndSaveNotificationSound = useCallback(
    async (
      file: File,
      contentType: string,
      extension: string,
      fileName: string,
      muted: boolean,
    ) => {
      if (!repository) {
        throw new Error('Unggahan suara memerlukan akun MoodTask.')
      }
      if (muted) {
        muteRequestedRef.current = true
        cancelCurrentPlayback()
        setNativeSoundDiagnostics((current) => ({
          ...current,
          playbackStatus: 'stopped',
          error: 'Suara notifikasi sedang dimatikan.',
        }))
      }
      setSoundSaving(true)
      setSoundError(null)
      const previous = soundPreferenceRef.current
      let uploadedPath: string | null = null
      let preferenceSaved = false
      let cleanupFailed = false
      try {
        uploadedPath = await repository.uploadNotificationSound(
          file,
          contentType,
          extension,
        )
        await repository.getNotificationSoundUrl(uploadedPath)
        const nextPreference: NotificationSoundPreference = {
          soundId: 'custom',
          muted,
          objectPath: uploadedPath,
          fileName: fileName.slice(0, 255),
        }
        await repository.saveNotificationSoundPreference(nextPreference)
        preferenceSaved = true
        soundPreferenceRef.current = nextPreference
        muteRequestedRef.current = false
        setSoundPreference(nextPreference)
        if (previous.soundId === 'custom' && previous.objectPath) {
          try {
            await repository.removeNotificationSound(previous.objectPath)
          } catch {
            setSoundError(
              'Suara baru tersimpan, tetapi unggahan sebelumnya belum terhapus.',
            )
          }
        }
        return nextPreference
      } catch (caught) {
        soundPreferenceRef.current = previous
        muteRequestedRef.current = false
        if (uploadedPath && !preferenceSaved) {
          await repository.removeNotificationSound(uploadedPath).catch(() => {
            cleanupFailed = true
          })
        }
        const message =
          caught instanceof Error
            ? caught.message
            : 'File suara belum dapat disimpan.'
        const feedback = cleanupFailed
          ? `Pilihan suara sebelumnya tetap digunakan. ${message} File sementara juga belum terhapus.`
          : `Pilihan suara sebelumnya tetap digunakan. ${message}`
        setSoundError(feedback)
        throw new Error(feedback, { cause: caught })
      } finally {
        setSoundSaving(false)
      }
    },
    [cancelCurrentPlayback, repository],
  )

  const playConfiguredNotificationSound = useCallback(
    async (eventId: string) => {
      if (!eventId) {
        console.warn(
          '[MoodTask] Reminder sound ignored: event ID is missing.',
          { timestamp_epoch_ms: Date.now() },
        )
        return
      }
      const trace = reminderLogFields(eventId)
      console.info('[MoodTask] Reminder playback handler invoked.', trace)
      if (playedEventIds.current.has(eventId)) {
        console.info(
          '[MoodTask] Reminder event rejected by deduplication.',
          trace,
        )
        return
      }

      if (soundLoading) {
        pendingEventIds.current.add(eventId)
        console.info(
          '[MoodTask] Reminder event queued until preferences load.',
          trace,
        )
        return
      }
      const preference = soundPreferenceRef.current
      if (preference.muted || muteRequestedRef.current) {
        cancelCurrentPlayback()
        setNativeSoundDiagnostics((current) => ({
          ...current,
          playbackStatus: 'stopped',
          error: 'Suara notifikasi sedang dimatikan.',
        }))
        console.info(
          '[MoodTask] Reminder sound skipped because sound is muted.',
          trace,
        )
        return
      }
      playedEventIds.current.add(eventId)
      console.info(
        '[MoodTask] Reminder event accepted by deduplication.',
        trace,
      )
      if (playedEventIds.current.size > 100) {
        const oldest = playedEventIds.current.values().next().value
        if (oldest) playedEventIds.current.delete(oldest)
      }
      const requestId = playbackRequestId.current + 1
      playbackRequestId.current = requestId
      const previousPlayback = currentPlayback.current
      currentPlayback.current = null
      previousPlayback?.stop()
      let playbackStage = 'load-custom-sound-url'
      try {
        let url: string | null = null
        if (preference.soundId === 'custom') {
          if (!preference.objectPath) {
            setNativeSoundDiagnostics((current) => ({
              ...current,
              audioUrlStatus: 'failure',
              error: 'File MP3 pilihan tidak ditemukan pada preferensi suara.',
            }))
            throw new Error('Custom sound path is missing.')
          }
          try {
            url = await getNotificationSoundUrl(preference.objectPath)
          } catch {
            setNativeSoundDiagnostics((current) => ({
              ...current,
              audioUrlStatus: 'failure',
              error: 'File MP3 gagal dimuat. Periksa koneksi dan file suara.',
            }))
            throw new Error('Custom sound URL could not be loaded.')
          }
        } else {
          setNativeSoundDiagnostics((current) => ({
            ...current,
            audioUrlStatus: 'unknown',
            error: null,
          }))
        }
        if (requestId !== playbackRequestId.current) return
        playbackStage = 'audio-play'
        console.info('[MoodTask] Reminder sound playback requested.', {
          ...trace,
          soundId: preference.soundId,
        })
        const playback = playNotificationSound(
          preference.soundId,
          url,
          preference.soundId === 'custom'
            ? {
                onCustomSourceLoaded: () =>
                  setNativeSoundDiagnostics((current) => ({
                    ...current,
                    audioUrlStatus: 'success',
                  })),
                onCustomSourceError: () =>
                  setNativeSoundDiagnostics((current) => ({
                    ...current,
                    audioUrlStatus: 'failure',
                    error:
                      'MP3 dari penyimpanan gagal dimuat oleh pemutar audio.',
                  })),
              }
            : undefined,
        )
        if (requestId !== playbackRequestId.current) {
          playback.stop()
          return
        }
        currentPlayback.current = playback
        setNativeSoundDiagnostics((current) => ({
          ...current,
          playbackStatus: 'starting',
          error: null,
        }))
        playback.onStatus((status, error) => {
          if (currentPlayback.current !== playback) return
          if (
            status === 'ended' ||
            status === 'stopped' ||
            status === 'error'
          ) {
            currentPlayback.current = null
          }
          if (status === 'error') {
            playedEventIds.current.delete(eventId)
            const errorName = error?.name || 'MediaError'
            console.warn('[MoodTask] Reminder sound media error.', {
              ...trace,
              stage: playbackStage,
              errorName,
            })
            const message =
              errorName === 'NotAllowedError'
                ? 'WebView memblokir pemutaran otomatis. Tekan “Dengarkan” untuk mengaktifkan audio.'
                : `Pemutaran gagal (${errorName}). Periksa file suara dan output audio Windows.`
            setNativeSoundDiagnostics((current) => ({
              ...current,
              playbackStatus: 'failure',
              error: message,
            }))
            setSoundError(message)
            return
          }
          setNativeSoundDiagnostics((current) => ({
            ...current,
            playbackStatus:
              status === 'started'
                ? 'started'
                : status === 'ended'
                  ? 'ended'
                  : 'stopped',
            error: null,
          }))
          if (status === 'started') {
            console.info('[MoodTask] Reminder sound playback started.', {
              ...trace,
              soundId: preference.soundId,
            })
          }
        })
      } catch (caught) {
        const errorName =
          caught instanceof Error && caught.name ? caught.name : 'UnknownError'
        console.warn('[MoodTask] Reminder sound playback failed.', {
          ...trace,
          stage: playbackStage,
          errorName,
        })
        if (requestId === playbackRequestId.current) {
          playedEventIds.current.delete(eventId)
        }
        setNativeSoundDiagnostics((current) => ({
          ...current,
          playbackStatus: 'failure',
          error:
            errorName === 'NotAllowedError'
              ? 'WebView memblokir pemutaran otomatis. Tekan “Dengarkan” untuk mengaktifkan audio.'
              : playbackStage === 'load-custom-sound-url'
                ? 'File MP3 gagal dimuat. Periksa koneksi dan preferensi suara.'
                : `Pemutaran gagal (${errorName}). Periksa file, mute, dan output audio Windows.`,
        }))
        setSoundError(
          errorName === 'NotAllowedError'
            ? 'WebView memblokir pemutaran otomatis. Buka pengaturan suara dan tekan “Dengarkan” untuk mengaktifkan audio.'
            : `Suara pengingat gagal diputar (${playbackStage}, ${errorName}). Periksa koneksi dan format file suara.`,
        )
      }
    },
    [cancelCurrentPlayback, getNotificationSoundUrl, soundLoading],
  )
  useEffect(() => {
    if (soundLoading || pendingEventIds.current.size === 0) return

    const pendingIds = [...pendingEventIds.current]
    pendingEventIds.current.clear()

    for (const eventId of pendingIds) {
      void playConfiguredNotificationSound(eventId)
    }
  }, [soundLoading, playConfiguredNotificationSound])

  const playConfiguredNotificationSoundRef = useRef(
    playConfiguredNotificationSound,
  )
  useEffect(() => {
    playConfiguredNotificationSoundRef.current = playConfiguredNotificationSound
  }, [playConfiguredNotificationSound])

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    console.info('[MoodTask] Native reminder listener registration started.', {
      timestamp_epoch_ms: Date.now(),
    })
    void listen<{ eventId: string }>(
      'moodtask://native-reminder-received',
      ({ payload }) => {
        if (disposed) return
        const hasEventId = typeof payload?.eventId === 'string'
        const trace = hasEventId
          ? reminderLogFields(payload.eventId as string)
          : { timestamp_epoch_ms: Date.now(), trace_id: null }
        console.info('[MoodTask] Native reminder listener callback received.', {
          ...trace,
          payload_has_event_id: hasEventId,
        })
        if (hasEventId) {
          const eventId = payload.eventId as string
          setNativeSoundDiagnostics((current) => ({
            ...current,
            eventReceived: true,
            audioUrlStatus: 'unknown',
            playbackStatus: 'unknown',
            error: null,
          }))
          console.info(
            '[MoodTask] Native reminder event accepted by React.',
            trace,
          )
          console.info(
            '[MoodTask] Native reminder acknowledgement started.',
            trace,
          )
          void acknowledgeNativeReminderEvent(eventId)
            .then(() => {
              console.info(
                '[MoodTask] Native reminder acknowledgement saved.',
                trace,
              )
            })
            .catch((caught: unknown) => {
              console.error(
                '[MoodTask] Native reminder acknowledgement failed; Rust will retry delivery.',
                {
                  ...trace,
                  errorName:
                    caught instanceof Error && caught.name
                      ? caught.name
                      : 'UnknownError',
                },
              )
            })
          void playConfiguredNotificationSoundRef
            .current(eventId)
            .catch((caught: unknown) => {
              console.error('[MoodTask] Reminder playback handler rejected.', {
                ...trace,
                errorName:
                  caught instanceof Error && caught.name
                    ? caught.name
                    : 'UnknownError',
              })
            })
        } else {
          console.warn(
            '[MoodTask] Native reminder event had an invalid payload.',
            {
              ...trace,
            },
          )
        }
      },
    )
      .then((stopListening) => {
        if (disposed) {
          stopListening()
          return
        }
        console.info('[MoodTask] Native reminder listener registered.', {
          timestamp_epoch_ms: Date.now(),
        })
        setNativeSoundDiagnostics((current) => ({
          ...current,
          listenerActive: true,
        }))
        unlisten = stopListening
      })
      .catch((caught: unknown) => {
        const errorName =
          caught instanceof Error && caught.name ? caught.name : 'UnknownError'
        const errorMessage = getNativeListenerErrorMessage(caught)
        console.error(
          '[MoodTask] Native reminder listener registration failed.',
          {
            timestamp_epoch_ms: Date.now(),
            errorName,
            reason: errorMessage,
          },
        )
        if (disposed) return
        setNativeSoundDiagnostics((current) => ({
          ...current,
          listenerActive: false,
          error: errorMessage,
        }))
        setSoundError(errorMessage)
      })
    return () => {
      disposed = true
      console.info('[MoodTask] Native reminder listener disposed.', {
        timestamp_epoch_ms: Date.now(),
      })
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    const serviceWorker = navigator.serviceWorker
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === 'object' &&
        event.data !== null &&
        'type' in event.data &&
        event.data.type === 'MOODTASK_REMINDER_RECEIVED' &&
        'eventId' in event.data &&
        typeof event.data.eventId === 'string'
      ) {
        void playConfiguredNotificationSound(event.data.eventId)
      }
    }
    serviceWorker.addEventListener('message', onMessage)
    return () => serviceWorker.removeEventListener('message', onMessage)
  }, [playConfiguredNotificationSound])

  useEffect(
    () => () => {
      cancelCurrentPlayback()
    },
    [cancelCurrentPlayback],
  )

  const saveReminder = useCallback(
    async (task: Task, minutesBefore: number, enabled = true) => {
      if (!repository) {
        throw new Error('Masuk ke akun MoodTask untuk menyimpan jadwal.')
      }
      validateReminderOffset(task, minutesBefore)
      setError(null)
      try {
        const saved = await repository.saveReminder(
          task.id,
          minutesBefore,
          enabled,
        )
        setReminders((current) => {
          const withoutConflict = current.filter(
            (reminder) =>
              reminder.id !== saved.id &&
              !(
                reminder.taskId === saved.taskId &&
                reminder.minutesBefore === saved.minutesBefore
              ),
          )
          return [...withoutConflict, saved].sort(
            (left, right) => left.minutesBefore - right.minutesBefore,
          )
        })
        return saved
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : 'Jadwal pengingat belum dapat disimpan.'
        setError(message)
        throw new Error(message, { cause: caught })
      }
    },
    [repository],
  )

  const removeReminder = useCallback(
    async (id: string) => {
      if (!repository)
        throw new Error('Masuk ke akun MoodTask terlebih dahulu.')
      setError(null)
      try {
        await repository.removeReminder(id)
        setReminders((current) => current.filter((item) => item.id !== id))
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : 'Jadwal pengingat belum dapat dihapus.'
        setError(message)
        throw new Error(message, { cause: caught })
      }
    },
    [repository],
  )

  const enablePush = useCallback(async () => {
    if (!repository) throw new Error('Masuk ke akun MoodTask terlebih dahulu.')
    setPushBusy(true)
    setError(null)
    let created = false
    let subscription: PushSubscription | null = null
    try {
      const result = await requestBrowserPushSubscription(publicVapidKey)
      subscription = result.subscription
      created = result.created
      const serialized = subscription.toJSON()
      const p256dh = serialized.keys?.p256dh
      const auth = serialized.keys?.auth
      if (!subscription.endpoint || !p256dh || !auth) {
        throw new Error('Browser tidak mengirim data langganan yang lengkap.')
      }
      const data: PushSubscriptionData = {
        endpoint: subscription.endpoint,
        origin: window.location.origin,
        expirationTime: subscription.expirationTime,
        keys: { p256dh, auth },
      }
      await repository.savePushSubscription(data)
      setPushSubscribed(true)
      setPushCapability(getCurrentPushCapability(publicVapidKey))
    } catch (caught) {
      if (created && subscription)
        await subscription.unsubscribe().catch(() => false)
      const message =
        caught instanceof Error
          ? caught.message
          : 'Notifikasi push belum dapat diaktifkan.'
      setPushCapability(getCurrentPushCapability(publicVapidKey))
      setError(message)
      throw new Error(message, { cause: caught })
    } finally {
      setPushBusy(false)
    }
  }, [repository])

  const disablePush = useCallback(async () => {
    if (!repository) throw new Error('Masuk ke akun MoodTask terlebih dahulu.')
    setPushBusy(true)
    setError(null)
    try {
      const subscription = await getCurrentBrowserPushSubscription()
      if (subscription) {
        // Remove the server route first; offline failures must not leave push active.
        await repository.removePushSubscription(subscription.endpoint)
        const removed = await subscription.unsubscribe()
        if (!removed) {
          throw new Error(
            'Push server sudah dinonaktifkan, tetapi browser belum menutup langganan. Coba lagi.',
          )
        }
      }
      setPushSubscribed(false)
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : 'Notifikasi push belum dapat dinonaktifkan.'
      setError(message)
      throw new Error(message, { cause: caught })
    } finally {
      setPushBusy(false)
    }
  }, [repository])

  const disablePushBeforeSignOut = useCallback(async () => {
    if (!repository) return
    await disablePush()
  }, [disablePush, repository])

  const value = useMemo(
    () => ({
      repositoryAvailable: repository !== null,
      reminders,
      loading,
      error,
      pushCapability,
      pushSubscribed,
      pushBusy,
      soundPreference,
      soundLoading,
      soundSaving,
      soundError,
      nativeSoundDiagnostics,
      clearNativeSoundDiagnostics,
      refresh,
      saveReminder,
      removeReminder,
      enablePush,
      disablePush,
      disablePushBeforeSignOut,
      saveNotificationSound,
      uploadAndSaveNotificationSound,
      getNotificationSoundUrl,
      playConfiguredNotificationSound,
      clearSoundError: () => setSoundError(null),
      clearError: () => setError(null),
    }),
    [
      repository,
      reminders,
      loading,
      error,
      pushCapability,
      pushSubscribed,
      pushBusy,
      soundPreference,
      soundLoading,
      soundSaving,
      soundError,
      nativeSoundDiagnostics,
      clearNativeSoundDiagnostics,
      refresh,
      saveReminder,
      removeReminder,
      enablePush,
      disablePush,
      disablePushBeforeSignOut,
      saveNotificationSound,
      uploadAndSaveNotificationSound,
      getNotificationSoundUrl,
      playConfiguredNotificationSound,
    ],
  )

  return (
    <ReminderSettingsContext.Provider value={value}>
      {children}
    </ReminderSettingsContext.Provider>
  )
}
