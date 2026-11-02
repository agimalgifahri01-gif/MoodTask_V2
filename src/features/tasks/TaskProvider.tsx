import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  validateTaskDraft,
  type Task,
  type TaskDraft,
  type TaskStatus,
} from './domain'
import { localStorageTaskRepository } from './LocalStorageTaskRepository'
import type { TaskRepository } from './TaskRepository'
import { TaskContext } from './TaskContext'

type Props = {
  children: ReactNode
  repository?: TaskRepository
  persistenceWarning?: string | null
  storageMode?: 'local' | 'cloud'
}

export function TaskProvider({
  children,
  repository = localStorageTaskRepository,
  persistenceWarning = null,
  storageMode = 'local',
}: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const tasksRef = useRef<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const loadedTasks = await repository.list()
      tasksRef.current = loadedTasks
      setTasks(loadedTasks)
    } catch (caught) {
      setLoadError(
        caught instanceof Error
          ? caught.message
          : 'Tugas belum dapat dimuat. Periksa koneksi lalu coba lagi.',
      )
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    let active = true
    void repository
      .list()
      .then((loadedTasks) => {
        if (!active) return
        tasksRef.current = loadedTasks
        setTasks(loadedTasks)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setLoadError(
          caught instanceof Error
            ? caught.message
            : 'Tugas belum dapat dimuat. Periksa koneksi lalu coba lagi.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [repository])

  const publish = useCallback((nextTasks: Task[]) => {
    tasksRef.current = nextTasks
    setTasks(nextTasks)
  }, [])

  const createTask = useCallback(
    async (input: TaskDraft) => {
      const draft = validateTaskDraft(input)
      const timestamp = new Date().toISOString()
      const task: Task = {
        ...draft,
        id: crypto.randomUUID(),
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      }
      const savedTask = await repository.create(task)
      publish([savedTask, ...tasksRef.current])
      return savedTask
    },
    [publish, repository],
  )

  const updateTask = useCallback(
    async (id: string, input: TaskDraft) => {
      const draft = validateTaskDraft(input)
      const existing = tasksRef.current.find((task) => task.id === id)
      if (!existing) throw new Error('Tugas tidak ditemukan.')
      const task: Task = {
        ...existing,
        ...draft,
        updatedAt: new Date().toISOString(),
      }
      const savedTask = await repository.update(task)
      publish(
        tasksRef.current.map((current) =>
          current.id === id ? savedTask : current,
        ),
      )
      return savedTask
    },
    [publish, repository],
  )

  const setStatus = useCallback(
    async (id: string, status: TaskStatus) => {
      const existing = tasksRef.current.find((task) => task.id === id)
      if (!existing) throw new Error('Tugas tidak ditemukan.')
      const timestamp = new Date().toISOString()
      const task: Task = {
        ...existing,
        status,
        completedAt: status === 'completed' ? timestamp : null,
        updatedAt: timestamp,
      }
      const savedTask = await repository.update(task)
      publish(
        tasksRef.current.map((current) =>
          current.id === id ? savedTask : current,
        ),
      )
    },
    [publish, repository],
  )

  const deleteTask = useCallback(
    async (id: string) => {
      if (!tasksRef.current.some((task) => task.id === id)) {
        throw new Error('Tugas tidak ditemukan.')
      }
      await repository.delete(id)
      publish(tasksRef.current.filter((task) => task.id !== id))
    },
    [publish, repository],
  )

  const value = useMemo(
    () => ({
      tasks,
      storageMode,
      persistenceWarning,
      loading,
      loadError,
      reload,
      createTask,
      updateTask,
      setStatus,
      deleteTask,
    }),
    [
      tasks,
      storageMode,
      persistenceWarning,
      loading,
      loadError,
      reload,
      createTask,
      updateTask,
      setStatus,
      deleteTask,
    ],
  )

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}
