import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseReminderRepository } from './SupabaseReminderRepository'

function fakeClient() {
  let upserted: unknown
  let upsertOptions: unknown
  let failure: { code: string; message: string } | null = null
  const filters: Array<[string, unknown]> = []
  const row = {
    id: 'reminder-1',
    task_id: 'task-1',
    user_id: 'user-a',
    origin: 'https://mood-task-v2.vercel.app',
    minutes_before: 60,
    enabled: true,
    created_at: '2026-11-01T00:00:00+00:00',
    sound_id: 'custom',
    muted: false,
    sound_object_path: 'user-a/sound.mp3',
    sound_file_name: 'my-tone.mp3',
  }
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      return chain
    }),
    order: vi.fn(async () => ({ data: [row], error: failure })),
    upsert: vi.fn((value: unknown, options?: unknown) => {
      upserted = value
      upsertOptions = options
      return chain
    }),
    delete: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: row, error: failure })),
    maybeSingle: vi.fn(async () => ({ data: row, error: failure })),
    then: (
      onfulfilled?:
        ((value: { data: null; error: typeof failure }) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) =>
      Promise.resolve({ data: null, error: failure }).then(
        onfulfilled,
        onrejected,
      ),
  }
  const client = {
    from: vi.fn(() => chain),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({
          data: { path: 'user-a/sound.mp3' },
          error: null,
        })),
        createSignedUrl: vi.fn(async () => ({
          data: { signedUrl: 'https://storage.example/signed-audio' },
          error: null,
        })),
        remove: vi.fn(async () => ({ data: [], error: null })),
      })),
    },
  } as unknown as SupabaseClient
  return {
    client,
    chain,
    filters,
    row,
    upserted: () => upserted,
    upsertOptions: () => upsertOptions,
    failWith: (error: { code: string; message: string }) => {
      failure = error
    },
  }
}

describe('SupabaseReminderRepository', () => {
  it('scopes reminder listing to the authenticated user', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    const result = await repository.list()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('reminder-1')
    expect(result[0].taskId).toBe('task-1')
    expect(fake.filters).toContainEqual(['user_id', 'user-a'])
  })

  it('binds the authenticated owner when saving a reminder', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    const saved = await repository.saveReminder('task-1', 60, true)
    expect(saved.minutesBefore).toBe(60)
    expect(fake.upserted()).toMatchObject({
      user_id: 'user-a',
      task_id: 'task-1',
      minutes_before: 60,
      enabled: true,
    })
  })

  it('reports clear migration error when task_reminders table does not exist (PGRST205 or 42P01)', async () => {
    const fake = fakeClient()
    fake.failWith({
      code: 'PGRST205',
      message:
        "Could not find the table 'public.task_reminders' in the schema cache",
    })
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    await expect(repository.saveReminder('task-1', 60, true)).rejects.toThrow(
      'Tabel pengingat belum tersedia di database. Jalankan migrasi database terlebih dahulu.',
    )

    fake.failWith({
      code: '42P01',
      message: 'relation "public.task_reminders" does not exist',
    })
    await expect(repository.list()).rejects.toThrow(
      'Tabel pengingat belum tersedia di database. Jalankan migrasi database terlebih dahulu.',
    )
  })

  it('rejects changes when user attempts to access or modify reminders of another user', async () => {
    const fake = fakeClient()
    fake.failWith({
      code: '42501',
      message: 'row-level security policy violation',
    })
    const repository = new SupabaseReminderRepository(fake.client, 'user-b')
    await expect(repository.saveReminder('task-1', 60, true)).rejects.toThrow(
      'Akses pengingat ditolak. Masuk kembali lalu coba lagi.',
    )
  })

  it('reports friendly error on foreign key violations for nonexistent tasks or mismatch', async () => {
    const fake = fakeClient()
    fake.failWith({ code: '23503', message: 'foreign key violation' })
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    await expect(
      repository.saveReminder('task-foreign', 30, true),
    ).rejects.toThrow(
      'Tugas tidak tersedia atau waktu pengingat tidak sesuai dengan rentang tugas.',
    )
  })

  it('reports friendly error when duplicate reminder offset already exists', async () => {
    const fake = fakeClient()
    fake.failWith({ code: '23505', message: 'unique constraint violation' })
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    await expect(repository.saveReminder('task-1', 60, true)).rejects.toThrow(
      'Jadwal pengingat dengan waktu tersebut sudah ada.',
    )
  })

  it('scopes reminder deletion to the owner and throws if not found', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    await expect(
      repository.removeReminder('reminder-1'),
    ).resolves.toBeUndefined()
    expect(fake.filters).toContainEqual(['id', 'reminder-1'])
    expect(fake.filters).toContainEqual(['user_id', 'user-a'])
  })

  it('scopes push subscription saving and idempotent removal to the authenticated user', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    await repository.savePushSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
      origin: 'https://mood-task-v2.vercel.app',
      expirationTime: null,
      keys: { p256dh: 'p256', auth: 'auth' },
    })
    expect(fake.upserted()).toMatchObject({
      user_id: 'user-a',
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
      origin: 'https://mood-task-v2.vercel.app',
    })
    expect(fake.upsertOptions()).toEqual({ onConflict: 'endpoint' })

    await repository.removePushSubscription(
      'https://fcm.googleapis.com/fcm/send/sub-1',
    )
    expect(fake.filters).toContainEqual([
      'endpoint',
      'https://fcm.googleapis.com/fcm/send/sub-1',
    ])
    expect(fake.filters).toContainEqual(['user_id', 'user-a'])
    expect(fake.chain.select).not.toHaveBeenCalled()
  })

  it('looks up a subscription origin only for the current endpoint and owner', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')

    await expect(
      repository.getPushSubscriptionOrigin(
        'https://fcm.googleapis.com/fcm/send/sub-1',
      ),
    ).resolves.toBe('https://mood-task-v2.vercel.app')
    expect(fake.filters).toContainEqual([
      'endpoint',
      'https://fcm.googleapis.com/fcm/send/sub-1',
    ])
    expect(fake.filters).toContainEqual(['user_id', 'user-a'])
  })

  it('rejects storing a push subscription from a non-canonical origin', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    await expect(
      repository.savePushSubscription({
        endpoint: 'https://fcm.googleapis.com/fcm/send/preview',
        origin: 'https://mood-task-v2-preview.vercel.app',
        expirationTime: null,
        keys: { p256dh: 'p256', auth: 'auth' },
      }),
    ).rejects.toThrow('Push hanya dapat disimpan untuk domain produksi')
    expect(fake.chain.upsert).not.toHaveBeenCalled()
  })

  it('reports subscription cleanup failures without removing other account rows', async () => {
    const fake = fakeClient()
    fake.failWith({ code: 'NETWORK', message: 'network failure' })
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')

    await expect(
      repository.removePushSubscription(
        'https://fcm.googleapis.com/fcm/send/sub-1',
      ),
    ).rejects.toThrow('Langganan notifikasi belum dapat dihapus dari server.')
    expect(fake.filters).toContainEqual(['user_id', 'user-a'])
    expect(fake.filters).toContainEqual([
      'endpoint',
      'https://fcm.googleapis.com/fcm/send/sub-1',
    ])
  })

  it('loads and saves a user-owned sound preference', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    const preference = await repository.getNotificationSoundPreference()
    expect(preference).toEqual({
      soundId: 'custom',
      muted: false,
      objectPath: 'user-a/sound.mp3',
      fileName: 'my-tone.mp3',
    })
    await repository.saveNotificationSoundPreference({
      soundId: 'bright-pop',
      muted: true,
      objectPath: null,
      fileName: null,
    })
    expect(fake.filters).toContainEqual(['user_id', 'user-a'])
    expect(fake.upserted()).toMatchObject({
      user_id: 'user-a',
      sound_id: 'bright-pop',
      muted: true,
      sound_object_path: null,
      sound_file_name: null,
    })
  })

  it('stores uploaded sounds under the owner folder and uses private signed URLs', async () => {
    const fake = fakeClient()
    const repository = new SupabaseReminderRepository(fake.client, 'user-a')
    const path = await repository.uploadNotificationSound(
      new File(['audio'], 'tone.mp3', { type: 'audio/mpeg' }),
      'audio/mpeg',
      'mp3',
    )
    expect(path).toMatch(/^user-a\/[0-9a-f-]+\.mp3$/)
    await expect(repository.getNotificationSoundUrl(path)).resolves.toBe(
      'https://storage.example/signed-audio',
    )
    await expect(
      repository.getNotificationSoundUrl('user-b/other.mp3'),
    ).rejects.toThrow('Lokasi suara unggahan tidak valid.')
    await expect(
      repository.removeNotificationSound(path),
    ).resolves.toBeUndefined()
  })
})
