import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Task } from './domain'
import { SupabaseTaskRepository } from './SupabaseTaskRepository'

const task: Task = {
  id: 'task-1',
  title: 'Tugas akun',
  description: '',
  startAt: '2026-10-22T00:00:00.000Z',
  deadlineAt: '2026-10-23T00:00:00.000Z',
  priority: 'high',
  status: 'active',
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
  completedAt: null,
}

function fakeClient() {
  let inserted: unknown
  let failure: { code: string; message: string } | null = null
  const filters: Array<[string, unknown]> = []
  const row = {
    id: task.id,
    user_id: 'user-a',
    title: task.title,
    description: task.description,
    start_at: '2026-10-22T00:00:00+00:00',
    deadline_at: '2026-10-23T00:00:00+00:00',
    priority: task.priority,
    status: task.status,
    created_at: '2026-10-22T00:00:00+00:00',
    updated_at: '2026-10-22T00:00:00+00:00',
    completed_at: task.completedAt,
  }
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      return chain
    }),
    order: vi.fn(async () => ({ data: [row], error: failure })),
    insert: vi.fn((value: unknown) => {
      inserted = value
      return chain
    }),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: row, error: failure })),
    maybeSingle: vi.fn(async () => ({ data: row, error: failure })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: failure }).then(resolve),
  }
  const client = {
    from: vi.fn(() => chain),
  } as unknown as SupabaseClient
  return {
    client,
    chain,
    filters,
    row,
    inserted: () => inserted,
    failWith: (error: { code: string; message: string }) => {
      failure = error
    },
  }
}

describe('SupabaseTaskRepository', () => {
  it('scopes reads by the authenticated owner and maps database fields', async () => {
    const fake = fakeClient()
    const repository = new SupabaseTaskRepository(fake.client, 'user-a')
    await expect(repository.list()).resolves.toEqual([task])
    expect(fake.filters).toContainEqual(['user_id', 'user-a'])
  })

  it('assigns the signed-in owner to task inserts', async () => {
    const fake = fakeClient()
    const repository = new SupabaseTaskRepository(fake.client, 'user-a')
    await expect(repository.create(task)).resolves.toEqual(task)
    expect(fake.inserted()).toMatchObject({ id: task.id, user_id: 'user-a' })
    expect(fake.inserted()).not.toHaveProperty('progress_percent')
  })

  it('sets the owner on every task imported from local storage', async () => {
    const fake = fakeClient()
    const repository = new SupabaseTaskRepository(fake.client, 'user-a')
    await repository.importTasks([task])
    expect(fake.inserted()).toEqual([
      expect.objectContaining({ user_id: 'user-a' }),
    ])
  })

  it('does not expose backend policy details on rejected reads', async () => {
    const fake = fakeClient()
    fake.failWith({ code: '42501', message: 'row-level security denied' })
    const repository = new SupabaseTaskRepository(fake.client, 'user-a')
    await expect(repository.list()).rejects.toThrow('Akses data ditolak')
  })
})
