import { useEffect, useRef } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { useTasks } from '../tasks/TaskContext'
import { useReminderSettings } from './ReminderSettingsContext'
import {
  buildNativeReminderSnapshot,
  syncNativeReminderSnapshot,
} from './nativeReminder'

export function NativeReminderBridge({
  ownerUserId,
  sessionReady,
}: {
  ownerUserId: string | null
  sessionReady: boolean
}) {
  const { tasks, loading: tasksLoading, loadError } = useTasks()
  const {
    reminders,
    loading: remindersLoading,
    error,
    nativeSoundDiagnostics,
  } = useReminderSettings()
  const listenerActive = nativeSoundDiagnostics.listenerActive
  const syncQueue = useRef(Promise.resolve())

  useEffect(() => {
    if (
      !sessionReady ||
      !ownerUserId ||
      tasksLoading ||
      remindersLoading ||
      !listenerActive ||
      loadError ||
      error ||
      !isTauri()
    ) {
      return
    }
    let snapshot: ReturnType<typeof buildNativeReminderSnapshot>
    try {
      snapshot = buildNativeReminderSnapshot(ownerUserId, tasks, reminders)
    } catch (caught) {
      console.warn(
        caught instanceof Error
          ? caught.message
          : 'Snapshot pengingat desktop tidak valid.',
      )
      return
    }
    syncQueue.current = syncQueue.current
      .catch(() => undefined)
      .then(() => syncNativeReminderSnapshot(snapshot))
      .catch(() => {
        console.warn(
          'Snapshot pengingat desktop belum tersimpan. Periksa koneksi aplikasi lalu buka kembali halaman.',
        )
      })
  }, [
    error,
    loadError,
    listenerActive,
    ownerUserId,
    reminders,
    remindersLoading,
    sessionReady,
    tasks,
    tasksLoading,
  ])

  return null
}
