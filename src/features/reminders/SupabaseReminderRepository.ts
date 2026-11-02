import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReminderRepository } from './ReminderRepository'
import type { PushSubscriptionData, TaskReminder } from './model'
import { CANONICAL_PUSH_ORIGIN } from './pushOrigins'
import {
  MAX_NOTIFICATION_SOUND_BYTES,
  NOTIFICATION_SOUND_BUCKET,
  type NotificationSoundPreference,
} from './notificationSound'

type ReminderRow = {
  id: string
  task_id: string
  user_id: string
  minutes_before: number
  enabled: boolean
  created_at: string
}

function toReminder(row: ReminderRow): TaskReminder {
  const createdAt = Date.parse(row.created_at)
  if (!Number.isFinite(createdAt)) {
    throw new Error('Server mengirim waktu pengingat yang tidak valid.')
  }
  return {
    id: row.id,
    taskId: row.task_id,
    minutesBefore: row.minutes_before,
    enabled: row.enabled,
    createdAt: new Date(createdAt).toISOString(),
  }
}

function throwReminderError(error: { code?: string; message: string }): never {
  const code = error?.code
  if (code) {
    console.warn(`[SupabaseReminderRepository] Database error code: ${code}`)
  }
  if (
    code === 'PGRST205' ||
    code === '42P01' ||
    (typeof error?.message === 'string' &&
      error.message.includes('task_reminders') &&
      error.message.includes('schema cache'))
  ) {
    throw new Error(
      'Tabel pengingat belum tersedia di database. Jalankan migrasi database terlebih dahulu.',
    )
  }
  if (code === '42501' || code === 'PGRST301') {
    throw new Error('Akses pengingat ditolak. Masuk kembali lalu coba lagi.')
  }
  if (code === '23503' || code === '23514') {
    throw new Error(
      'Tugas tidak tersedia atau waktu pengingat tidak sesuai dengan rentang tugas.',
    )
  }
  if (code === '23505') {
    throw new Error('Jadwal pengingat dengan waktu tersebut sudah ada.')
  }
  throw new Error(
    'Jadwal pengingat belum dapat disimpan. Periksa koneksi lalu coba lagi.',
  )
}

function assertOwnedSoundPath(path: string, userId: string) {
  if (
    !path.startsWith(`${userId}/`) ||
    path.includes('..') ||
    path.split('/').length !== 2
  ) {
    throw new Error('Lokasi suara unggahan tidak valid.')
  }
}

/** Signed-in repository; Postgres RLS and owner-bound foreign keys authorize writes. */
export class SupabaseReminderRepository implements ReminderRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async list(): Promise<TaskReminder[]> {
    const { data, error } = await this.client
      .from('task_reminders')
      .select('id,task_id,user_id,minutes_before,enabled,created_at')
      .eq('user_id', this.userId)
      .order('minutes_before', { ascending: true })
    if (error) throwReminderError(error)
    return (data as ReminderRow[]).map(toReminder)
  }

  async saveReminder(
    taskId: string,
    minutesBefore: number,
    enabled: boolean,
  ): Promise<TaskReminder> {
    const { data, error } = await this.client
      .from('task_reminders')
      .upsert(
        {
          user_id: this.userId,
          task_id: taskId,
          minutes_before: minutesBefore,
          enabled,
        },
        { onConflict: 'task_id,minutes_before' },
      )
      .select('id,task_id,user_id,minutes_before,enabled,created_at')
      .single()
    if (error) throwReminderError(error)
    return toReminder(data as ReminderRow)
  }

  async removeReminder(id: string): Promise<void> {
    const { data, error } = await this.client
      .from('task_reminders')
      .delete()
      .eq('id', id)
      .eq('user_id', this.userId)
      .select('id')
      .maybeSingle()
    if (error) throwReminderError(error)
    if (!data) throw new Error('Jadwal tidak ditemukan atau akses berubah.')
  }

  async savePushSubscription(
    subscription: PushSubscriptionData,
  ): Promise<void> {
    if (subscription.origin !== CANONICAL_PUSH_ORIGIN) {
      throw new Error(
        'Push hanya dapat disimpan untuk domain produksi MoodTask.',
      )
    }
    const { error } = await this.client.from('push_subscriptions').upsert(
      {
        user_id: this.userId,
        endpoint: subscription.endpoint,
        origin: subscription.origin,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expires_at: subscription.expirationTime
          ? new Date(subscription.expirationTime).toISOString()
          : null,
      },
      { onConflict: 'endpoint' },
    )
    if (error) throwReminderError(error)
  }

  async getPushSubscriptionOrigin(endpoint: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('push_subscriptions')
      .select('origin')
      .eq('endpoint', endpoint)
      .eq('user_id', this.userId)
      .maybeSingle()
    if (error) {
      throw new Error(
        'Asal langganan notifikasi belum dapat diverifikasi. Periksa koneksi lalu coba lagi.',
      )
    }
    return typeof data?.origin === 'string' ? data.origin : null
  }

  async removePushSubscription(endpoint: string): Promise<void> {
    const { error } = await this.client
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', this.userId)
    if (error) {
      if (error.code === '42501' || error.code === 'PGRST301') {
        throw new Error(
          'Akses notifikasi ditolak. Masuk kembali lalu coba keluar lagi.',
        )
      }
      throw new Error(
        'Langganan notifikasi belum dapat dihapus dari server. Periksa koneksi lalu coba lagi.',
      )
    }
  }

  async getNotificationSoundPreference(): Promise<NotificationSoundPreference | null> {
    const { data, error } = await this.client
      .from('notification_preferences')
      .select('sound_id,muted,sound_object_path,sound_file_name')
      .eq('user_id', this.userId)
      .maybeSingle()
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        throw new Error(
          'Pengaturan suara belum tersedia di database. Terapkan migrasi notifikasi terlebih dahulu.',
        )
      }
      throwReminderError(error)
    }
    if (!data) return null
    const row = data as {
      sound_id: string
      muted: boolean
      sound_object_path: string | null
      sound_file_name: string | null
    }
    if (
      !['momo-chime', 'soft-bell', 'bright-pop', 'custom'].includes(
        row.sound_id,
      ) ||
      typeof row.muted !== 'boolean'
    ) {
      throw new Error('Preferensi suara dari server tidak valid.')
    }
    if (row.sound_id === 'custom') {
      if (!row.sound_object_path) {
        throw new Error('File suara unggahan pada akun tidak ditemukan.')
      }
      if (
        typeof row.sound_file_name !== 'string' ||
        row.sound_file_name.length < 1 ||
        row.sound_file_name.length > 255
      ) {
        throw new Error('Nama file suara pada akun tidak valid.')
      }
      assertOwnedSoundPath(row.sound_object_path, this.userId)
    } else if (row.sound_object_path !== null || row.sound_file_name !== null) {
      throw new Error('Preferensi suara dari server tidak konsisten.')
    }
    return {
      soundId: row.sound_id as NotificationSoundPreference['soundId'],
      muted: row.muted,
      objectPath: row.sound_object_path,
      fileName: row.sound_file_name,
    }
  }

  async saveNotificationSoundPreference(
    preference: NotificationSoundPreference,
  ): Promise<void> {
    if (preference.soundId === 'custom') {
      if (!preference.objectPath) {
        throw new Error('Pilih file suara sebelum menyimpan preferensi.')
      }
      if (
        !preference.fileName ||
        preference.fileName.length < 1 ||
        preference.fileName.length > 255
      ) {
        throw new Error('Nama file suara tidak valid.')
      }
      assertOwnedSoundPath(preference.objectPath, this.userId)
    } else if (preference.objectPath !== null || preference.fileName !== null) {
      throw new Error('Preferensi suara bawaan tidak boleh memiliki file.')
    }
    const { error } = await this.client.from('notification_preferences').upsert(
      {
        user_id: this.userId,
        sound_id: preference.soundId,
        muted: preference.muted,
        sound_object_path: preference.objectPath,
        sound_file_name: preference.fileName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        throw new Error(
          'Pengaturan suara belum tersedia di database. Terapkan migrasi notifikasi terlebih dahulu.',
        )
      }
      throwReminderError(error)
    }
  }

  async uploadNotificationSound(
    file: File,
    contentType: string,
    extension: string,
  ): Promise<string> {
    if (!file.size || file.size > MAX_NOTIFICATION_SOUND_BYTES) {
      throw new Error('Ukuran suara maksimal 5 MiB.')
    }
    const path = `${this.userId}/${crypto.randomUUID()}.${extension}`
    const { error } = await this.client.storage
      .from(NOTIFICATION_SOUND_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        contentType,
        upsert: false,
      })
    if (error) {
      throw new Error(
        'File suara belum dapat diunggah. Periksa koneksi lalu coba lagi.',
      )
    }
    return path
  }

  async getNotificationSoundUrl(path: string): Promise<string> {
    assertOwnedSoundPath(path, this.userId)
    const { data, error } = await this.client.storage
      .from(NOTIFICATION_SOUND_BUCKET)
      .createSignedUrl(path, 60 * 60)
    if (error || !data?.signedUrl) {
      throw new Error('File suara belum dapat dibuka dari penyimpanan akun.')
    }
    return data.signedUrl
  }

  async removeNotificationSound(path: string): Promise<void> {
    assertOwnedSoundPath(path, this.userId)
    const { error } = await this.client.storage
      .from(NOTIFICATION_SOUND_BUCKET)
      .remove([path])
    if (error) {
      throw new Error('File suara lama belum dapat dihapus dari akun.')
    }
  }
}
