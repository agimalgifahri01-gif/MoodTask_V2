import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ReminderRepository } from './ReminderRepository'
import {
  getCurrentBrowserPushSubscription,
  getCurrentPushCapability,
  requestBrowserPushSubscription,
  type PushCapability,
} from './browserPush'
import type { PushSubscriptionData, TaskReminder } from './model'
import { validateReminderOffset } from './model'
import type { Task } from '../tasks/domain'
import { ReminderSettingsContext } from './ReminderSettingsContext'
import {
  DEFAULT_NOTIFICATION_SOUND,
  playNotificationSound,
  type NotificationSoundPreference,
} from './notificationSound'

const localSoundPreferenceKey = 'moodtask.notification-sound.v1'

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
  const [soundLoading, setSoundLoading] = useState(repository !== null)
  const [soundSaving, setSoundSaving] = useState(false)
  const [soundError, setSoundError] = useState<string | null>(null)
  const currentPlayback = useRef<{ stop: () => void } | null>(null)
  const playedEventIds = useRef(new Set<string>())

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
      setSoundPreference(readLocalSoundPreference())
    }
  }

  useEffect(() => {
    let active = true
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
            setSoundPreference(preference ?? DEFAULT_NOTIFICATION_SOUND)
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
        if (active) setPushSubscribed(subscription !== null)
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
          preference.objectPath !== soundPreference.objectPath ||
          preference.fileName !== soundPreference.fileName
        ) {
          throw new Error('Unggah file suara sebelum memilih suara kustom.')
        }
      } else if (
        preference.objectPath !== null ||
        preference.fileName !== null
      ) {
        throw new Error('Pilih unggahan baru untuk menyimpan suara kustom.')
      }
      setSoundSaving(true)
      setSoundError(null)
      const previous = soundPreference
      try {
        if (repository) {
          await repository.saveNotificationSoundPreference(preference)
        } else {
          localStorage.setItem(
            localSoundPreferenceKey,
            JSON.stringify(preference),
          )
        }
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
    [repository, soundPreference],
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
      setSoundSaving(true)
      setSoundError(null)
      const previous = soundPreference
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
    [repository, soundPreference],
  )

  const playConfiguredNotificationSound = useCallback(
    async (eventId: string) => {
      if (soundLoading || !eventId || playedEventIds.current.has(eventId))
        return
      playedEventIds.current.add(eventId)
      if (playedEventIds.current.size > 100) {
        const oldest = playedEventIds.current.values().next().value
        if (oldest) playedEventIds.current.delete(oldest)
      }
      if (soundPreference.muted) return
      try {
        currentPlayback.current?.stop()
        const url =
          soundPreference.soundId === 'custom' && soundPreference.objectPath
            ? await getNotificationSoundUrl(soundPreference.objectPath)
            : null
        currentPlayback.current = await playNotificationSound(
          soundPreference.soundId,
          url,
        )
      } catch {
        setSoundError(
          'Browser tidak dapat memutar suara notifikasi otomatis. Gunakan “Dengarkan” untuk mengizinkan audio, atau periksa format dan pengaturan browser.',
        )
      }
    },
    [getNotificationSoundUrl, soundLoading, soundPreference],
  )

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
    return () => {
      serviceWorker.removeEventListener('message', onMessage)
      currentPlayback.current?.stop()
      currentPlayback.current = null
    }
  }, [playConfiguredNotificationSound])

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
