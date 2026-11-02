import type { SupabaseClient } from '@supabase/supabase-js'
import type { Task, TaskPriority, TaskStatus } from './domain'
import type { TaskMigrationTarget, TaskRepository } from './TaskRepository'

type TaskRow = {
  id: string
  user_id: string
  title: string
  description: string
  start_at: string
  deadline_at: string
  priority: TaskPriority
  status: TaskStatus
  created_at: string
  updated_at: string
  completed_at: string | null
}

function toTask(row: TaskRow): Task {
  const normalizeInstant = (value: string) => {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) {
      throw new Error('Server mengirim format tanggal tugas yang tidak valid.')
    }
    return new Date(timestamp).toISOString()
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: normalizeInstant(row.start_at),
    deadlineAt: normalizeInstant(row.deadline_at),
    priority: row.priority,
    status: row.status,
    createdAt: normalizeInstant(row.created_at),
    updatedAt: normalizeInstant(row.updated_at),
    completedAt: row.completed_at ? normalizeInstant(row.completed_at) : null,
  }
}

function toRow(task: Task, userId: string) {
  return {
    id: task.id,
    user_id: userId,
    title: task.title,
    description: task.description,
    start_at: task.startAt,
    deadline_at: task.deadlineAt,
    priority: task.priority,
    status: task.status,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    completed_at: task.completedAt,
  }
}

function throwRepositoryError(error: {
  code?: string
  message: string
}): never {
  if (error.code === '42501' || error.code === 'PGRST301') {
    throw new Error('Akses data ditolak. Sesi mungkin berakhir; masuk kembali.')
  }
  if (error.code === '23505') {
    throw new Error('Tugas dengan identitas ini sudah ada di akun.')
  }
  throw new Error(
    'Data akun belum dapat disinkronkan. Periksa koneksi lalu coba lagi.',
  )
}

/** Uses the signed-in Supabase client; database RLS remains the authority. */
export class SupabaseTaskRepository
  implements TaskRepository, TaskMigrationTarget
{
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async list(): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tasks')
      .select(
        'id,user_id,title,description,start_at,deadline_at,priority,status,created_at,updated_at,completed_at',
      )
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
    if (error) throwRepositoryError(error)
    return (data as TaskRow[]).map(toTask)
  }

  async create(task: Task): Promise<Task> {
    const { data, error } = await this.client
      .from('tasks')
      .insert(toRow(task, this.userId))
      .select(
        'id,user_id,title,description,start_at,deadline_at,priority,status,created_at,updated_at,completed_at',
      )
      .single()
    if (error) throwRepositoryError(error)
    return toTask(data as TaskRow)
  }

  async update(task: Task): Promise<Task> {
    const { data, error } = await this.client
      .from('tasks')
      .update(toRow(task, this.userId))
      .eq('id', task.id)
      .eq('user_id', this.userId)
      .select(
        'id,user_id,title,description,start_at,deadline_at,priority,status,created_at,updated_at,completed_at',
      )
      .maybeSingle()
    if (error) throwRepositoryError(error)
    if (!data)
      throw new Error('Tugas tidak ditemukan atau akses telah berubah.')
    return toTask(data as TaskRow)
  }

  async delete(id: string): Promise<void> {
    const { data, error } = await this.client
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', this.userId)
      .select('id')
      .maybeSingle()
    if (error) throwRepositoryError(error)
    if (!data)
      throw new Error('Tugas tidak ditemukan atau akses telah berubah.')
  }

  async importTasks(tasks: Task[]): Promise<void> {
    if (tasks.length === 0) return
    const { error } = await this.client
      .from('tasks')
      .insert(tasks.map((task) => toRow(task, this.userId)))
    if (error) throwRepositoryError(error)
  }
}
