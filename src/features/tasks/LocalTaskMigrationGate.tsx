import { useEffect, useState, type ReactNode } from 'react'
import type { Task } from './domain'
import type { TaskMigrationSource, TaskMigrationTarget } from './TaskRepository'
import {
  LocalTasksChangedDuringMigrationError,
  migrateLocalTasksOnce,
} from './migrateLocalTasks'

type ReadyState = {
  migrated: number
  localCount: number | null
  localRetained: boolean
}

type GateState =
  | { status: 'checking' }
  | { status: 'consent'; tasks: Task[] }
  | { status: 'working' }
  | {
      status: 'error'
      message: string
      approvedTasks: Task[] | null
      localCount: number | null
    }
  | { status: 'ready'; result: ReadyState }

type Props = {
  userId: string
  local: TaskMigrationSource
  remote: TaskMigrationTarget
  onSignOut?: () => Promise<void>
  children: (result: ReadyState) => ReactNode
}

function messageFor(caught: unknown): string {
  return caught instanceof Error
    ? caught.message
    : 'Tugas lokal belum dapat disiapkan. Data lokal tetap dipertahankan.'
}

export default function LocalTaskMigrationGate({
  userId,
  local,
  remote,
  onSignOut,
  children,
}: Props) {
  const [attempt, setAttempt] = useState(0)
  const [signOutError, setSignOutError] = useState('')
  const [state, setState] = useState<GateState>({ status: 'checking' })

  useEffect(() => {
    let active = true
    void local
      .list()
      .then((tasks) => {
        if (!active) return
        setState(
          tasks.length > 0
            ? { status: 'consent', tasks }
            : {
                status: 'ready',
                result: { migrated: 0, localCount: 0, localRetained: false },
              },
        )
      })
      .catch((caught: unknown) => {
        if (!active) return
        setState({
          status: 'error',
          message: messageFor(caught),
          approvedTasks: null,
          localCount: null,
        })
      })
    return () => {
      active = false
    }
  }, [attempt, local])

  async function approveMigration(tasks: Task[]) {
    setState({ status: 'working' })
    try {
      const migrated = await migrateLocalTasksOnce(userId, local, remote, tasks)
      setState({
        status: 'ready',
        result: {
          migrated,
          localCount: tasks.length,
          localRetained: false,
        },
      })
    } catch (caught) {
      if (caught instanceof LocalTasksChangedDuringMigrationError) {
        setState({ status: 'checking' })
        setAttempt((current) => current + 1)
        return
      }
      setState({
        status: 'error',
        message: messageFor(caught),
        approvedTasks: tasks,
        localCount: tasks.length,
      })
    }
  }

  function continueWithoutMigration(localCount: number | null) {
    setState({
      status: 'ready',
      result: {
        migrated: 0,
        localCount,
        localRetained: localCount === null || localCount > 0,
      },
    })
  }

  async function leaveAccount() {
    setSignOutError('')
    try {
      await onSignOut?.()
    } catch (caught) {
      setSignOutError(
        caught instanceof Error
          ? caught.message
          : 'Belum dapat keluar dari akun.',
      )
    }
  }

  if (state.status === 'ready') return children(state.result)

  if (state.status === 'consent') {
    const count = state.tasks.length
    return (
      <main
        className="app-state migration-consent"
        aria-labelledby="migration-title"
      >
        <span className="app-state-mark" aria-hidden="true" />
        <h1 id="migration-title">Tugas lokal ditemukan</h1>
        <p>
          Ada <strong>{count} tugas</strong> di penyimpanan browser perangkat
          ini. Jika disetujui, tugas tersebut akan disalin ke akun MoodTask yang
          sedang masuk. Salinan lokal baru dihapus setelah semua tugas
          diverifikasi pada akun.
        </p>
        <p>
          Judul dan isi tugas tidak dikirim sebelum kamu menyetujui pemindahan.
        </p>
        {signOutError && <p role="alert">{signOutError}</p>}
        <div className="app-state-actions">
          <button
            className="button button-primary"
            onClick={() => void approveMigration(state.tasks)}
          >
            Pindahkan {count} tugas ke akun ini
          </button>
          <button
            className="button button-quiet"
            onClick={() => continueWithoutMigration(count)}
          >
            Lanjut tanpa memindahkan
          </button>
          {onSignOut && (
            <button
              className="button button-quiet"
              onClick={() => void leaveAccount()}
            >
              Keluar dari akun
            </button>
          )}
        </div>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="app-state" role="alert">
        <strong>Sinkronisasi belum siap</strong>
        <p>{state.message}</p>
        <p>
          Salinan lokal dipertahankan. Kamu dapat memakai akun tanpa
          memindahkannya.
        </p>
        {signOutError && <p role="alert">{signOutError}</p>}
        <div className="app-state-actions">
          {state.approvedTasks ? (
            <button
              className="button button-primary"
              onClick={() => void approveMigration(state.approvedTasks!)}
            >
              Coba pindahkan lagi
            </button>
          ) : (
            <button
              className="button button-primary"
              onClick={() => {
                setState({ status: 'checking' })
                setAttempt((current) => current + 1)
              }}
            >
              Periksa lagi
            </button>
          )}
          <button
            className="button button-quiet"
            onClick={() => continueWithoutMigration(state.localCount)}
          >
            Lanjut tanpa memindahkan
          </button>
          {onSignOut && (
            <button
              className="button button-quiet"
              onClick={() => void leaveAccount()}
            >
              Keluar tanpa menghapus data lokal
            </button>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="app-state" role="status" aria-live="polite">
      <span className="app-state-mark" />
      <strong>
        {state.status === 'working'
          ? 'Memindahkan tugas yang disetujui'
          : 'Memeriksa penyimpanan lokal'}
      </strong>
      <span>
        Data lokal tetap tersimpan sampai proses yang disetujui berhasil
        diverifikasi.
      </span>
    </main>
  )
}
