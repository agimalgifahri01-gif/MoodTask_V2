import { useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from '../components/AppLayout'
import AuthPage from '../pages/AuthPage'
import CharacterPage from '../pages/CharacterPage'
import DashboardPage from '../pages/DashboardPage'
import RemindersPage from '../pages/RemindersPage'
import SettingsPage from '../pages/SettingsPage'
import TasksPage from '../pages/TasksPage'
import { useAuth } from '../features/auth/AuthContext'
import type { SupabaseClient } from '@supabase/supabase-js'
import { localStorageTaskRepository } from '../features/tasks/LocalStorageTaskRepository'
import { SupabaseTaskRepository } from '../features/tasks/SupabaseTaskRepository'
import LocalTaskMigrationGate from '../features/tasks/LocalTaskMigrationGate'
import { TaskProvider } from '../features/tasks/TaskProvider'
import { useTasks } from '../features/tasks/TaskContext'
import { ReminderSettingsProvider } from '../features/reminders/ReminderSettingsContext'
import { SupabaseReminderRepository } from '../features/reminders/SupabaseReminderRepository'
import { useSafeSignOut } from '../features/auth/useSafeSignOut'

export function AppRoutes() {
  const { loading, loadError, reload } = useTasks()
  const { user } = useAuth()
  const safeSignOut = useSafeSignOut()
  const [accountError, setAccountError] = useState('')

  async function leaveAccount() {
    setAccountError('')
    try {
      await safeSignOut()
    } catch (caught) {
      setAccountError(
        caught instanceof Error
          ? caught.message
          : 'Belum dapat keluar dari akun.',
      )
    }
  }

  if (loading) {
    return (
      <main className="app-state" role="status" aria-live="polite">
        <span className="app-state-mark" />
        <strong>Memuat tugasmu…</strong>
        <span>Menyiapkan ruang MoodTask.</span>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="app-state" role="alert">
        <strong>Tugas belum dapat dimuat</strong>
        <p>{loadError}</p>
        <button className="button button-primary" onClick={() => void reload()}>
          Coba lagi
        </button>
        {user && (
          <button
            className="button button-quiet"
            onClick={() => void leaveAccount()}
          >
            Keluar dari akun
          </button>
        )}
        {accountError && <span role="alert">{accountError}</span>}
      </main>
    )
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="character" element={<CharacterPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="auth" element={<AuthPage key="auth" />} />
        <Route
          path="auth/recovery"
          element={<AuthPage key="recovery" recovery />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function Workspace() {
  return (
    <TaskProvider repository={localStorageTaskRepository}>
      <ReminderSettingsProvider repository={null}>
        <AppRoutes />
      </ReminderSettingsProvider>
    </TaskProvider>
  )
}

function AuthenticatedWorkspaceContent({
  userId,
  client,
}: {
  userId: string
  client: SupabaseClient
}) {
  const safeSignOut = useSafeSignOut()
  const repository = useMemo(
    () => new SupabaseTaskRepository(client, userId),
    [client, userId],
  )

  return (
    <LocalTaskMigrationGate
      key={`migration-${userId}`}
      userId={userId}
      local={localStorageTaskRepository}
      remote={repository}
      onSignOut={safeSignOut}
    >
      {(migration) => (
        <TaskProvider
          key={`account-${userId}`}
          repository={repository}
          storageMode="cloud"
          persistenceWarning={
            migration.localRetained
              ? migration.localCount === null
                ? 'Data lokal mungkin masih tersimpan di browser perangkat ini; jumlahnya belum dapat diperiksa dan data tersebut tidak dipindahkan ke akun.'
                : `${migration.localCount} tugas tetap tersimpan di browser perangkat ini dan tidak dipindahkan ke akun.`
              : migration.localCount !== null && migration.localCount > 0
                ? `${migration.localCount} tugas lokal telah disetujui dan diverifikasi pada akun; ${migration.migrated} tugas baru diimpor.`
                : null
          }
        >
          <AppRoutes />
        </TaskProvider>
      )}
    </LocalTaskMigrationGate>
  )
}

function AuthenticatedWorkspace({
  userId,
  client,
}: {
  userId: string
  client: SupabaseClient
}) {
  const reminderRepository = useMemo(
    () => new SupabaseReminderRepository(client, userId),
    [client, userId],
  )

  return (
    <ReminderSettingsProvider repository={reminderRepository}>
      <AuthenticatedWorkspaceContent userId={userId} client={client} />
    </ReminderSettingsProvider>
  )
}

export default function App() {
  const { status, user, authError, client } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <main className="app-state" role="status" aria-live="polite">
        <span className="app-state-mark" />
        <strong>Memulihkan sesi akun…</strong>
      </main>
    )
  }

  if (status === 'signed-in' && location.pathname === '/auth/recovery') {
    return (
      <main className="auth-recovery-shell">
        <AuthPage recovery />
      </main>
    )
  }

  if (status === 'signed-in' && user && client) {
    return (
      <AuthenticatedWorkspace key={user.id} userId={user.id} client={client} />
    )
  }

  return (
    <>
      {status === 'unavailable' && authError && (
        <div className="auth-session-warning" role="status">
          {authError} MoodTask tetap tersedia dengan data lokal.{' '}
          <Link to="/auth">Coba masuk kembali</Link>
        </div>
      )}
      <Workspace />
    </>
  )
}
