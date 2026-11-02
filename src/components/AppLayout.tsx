import { Link, NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import {
  Bell,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Home,
  ListTodo,
  LogOut,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { useAuth } from '../features/auth/AuthContext'
import { useSafeSignOut } from '../features/auth/useSafeSignOut'

const navigation = [
  { to: '/', label: 'Beranda', icon: Home, end: true },
  { to: '/tasks', label: 'Tugas saya', icon: ListTodo },
  { to: '/character', label: 'Karakter', icon: Sparkles },
  { to: '/reminders', label: 'Pengingat', icon: Bell },
]

export default function AppLayout() {
  const { user } = useAuth()
  const safeSignOut = useSafeSignOut()
  const [accountError, setAccountError] = useState('')

  async function handleSignOut() {
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

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Lewati ke konten
      </a>
      <aside className="sidebar" aria-label="Navigasi utama">
        <NavLink to="/" className="brand" aria-label="MoodTask, ke beranda">
          <span className="brand-mark">
            <span />
          </span>
          <span className="brand-name">
            moodtask<span>.</span>
          </span>
        </NavLink>

        <div className="workspace-label">RUANG KERJAMU</div>
        <nav className="main-nav">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}`
              }
            >
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {label === 'Pengingat' && <span className="nav-soon">nanti</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div className="note-icon">
              <CircleHelp size={18} />
            </div>
            <div>
              <strong>Mulai pelan-pelan</strong>
              <span>Satu langkah kecil sudah berarti.</span>
            </div>
          </div>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Settings2 size={19} strokeWidth={1.8} aria-hidden="true" />
            <span>Pengaturan</span>
          </NavLink>
          {user ? (
            <div className="profile-mini">
              <div className="avatar-initials">
                {user.email?.[0]?.toUpperCase() ?? 'A'}
              </div>
              <div className="profile-copy">
                <strong>{user.email ?? 'Akun MoodTask'}</strong>
                <span>Akun tersambung</span>
              </div>
              <button
                type="button"
                className="account-action"
                onClick={() => void handleSignOut()}
                aria-label="Keluar dari akun"
                title="Keluar"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <Link
              className="profile-mini profile-login"
              to="/auth"
              aria-label="Masuk ke akun MoodTask"
            >
              <div className="avatar-initials">M</div>
              <div className="profile-copy">
                <strong>Pengunjung</strong>
                <span>Belum masuk</span>
              </div>
              <ChevronDown size={16} className="muted-icon" />
            </Link>
          )}
          {accountError && (
            <p className="account-error" role="alert">
              {accountError}
            </p>
          )}
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <CalendarDays size={16} />
            <span>Ruang pribadi</span>
            <span className="breadcrumb-dot">/</span>
            <strong>Hari ini</strong>
          </div>
          <div className="topbar-right">
            <span className="today-date">
              Tempat yang nyaman untuk mulai lagi.
            </span>
            <Link
              className="icon-button"
              to="/settings"
              aria-label="Buka pengaturan"
            >
              <Settings2 size={19} />
            </Link>
          </div>
        </header>
        <main id="main-content" className="page-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>
            moodtask<span className="footer-dot">.</span>
          </span>
          <span>Pelan-pelan juga tetap maju.</span>
        </footer>
      </div>
    </div>
  )
}
