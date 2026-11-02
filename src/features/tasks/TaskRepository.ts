import type { Task } from './domain'

export type TaskLoadResult = {
  tasks: Task[]
  warning: string | null
}

/** Async data boundary keeps the application independent of local/remote storage. */
export interface TaskRepository {
  list(): Promise<Task[]>
  create(task: Task): Promise<Task>
  update(task: Task): Promise<Task>
  delete(id: string): Promise<void>
}

export interface TaskMigrationSource extends Pick<TaskRepository, 'list'> {
  clearAfterVerifiedMigration(expectedTasks: Task[]): Promise<void>
}

export interface TaskMigrationTarget extends Pick<TaskRepository, 'list'> {
  importTasks(tasks: Task[]): Promise<void>
}
