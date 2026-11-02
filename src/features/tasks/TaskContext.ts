import { createContext, useContext } from 'react'
import type { Task, TaskDraft, TaskStatus } from './domain'

export type TaskContextValue = {
  tasks: Task[]
  storageMode: 'local' | 'cloud'
  persistenceWarning: string | null
  loading: boolean
  loadError: string | null
  reload: () => Promise<void>
  createTask: (draft: TaskDraft) => Promise<Task>
  updateTask: (id: string, draft: TaskDraft) => Promise<Task>
  setStatus: (id: string, status: TaskStatus) => Promise<void>
  deleteTask: (id: string) => Promise<void>
}

export const TaskContext = createContext<TaskContextValue | null>(null)

export function useTasks() {
  const context = useContext(TaskContext)
  if (!context) throw new Error('useTasks harus dipakai di dalam TaskProvider.')
  return context
}
