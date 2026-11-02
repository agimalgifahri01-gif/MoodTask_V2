import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, KeyRound, Mail, Sparkles } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import PageIntro from '../components/PageIntro'
import { useAuth } from '../features/auth/AuthContext'

type AuthMode = 'sign-in' | 'sign-up' | 'reset-request' | 'recovery'

export default function AuthPage({ recovery = false }: { recovery?: boolean }) {
  const {
    status,
    service,
    configurationError,
    signIn,
    signUp,
    requestPasswordReset,
    updatePassword,
  } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>(recovery ? 'recovery' : 'sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (status === 'signed-in' && mode !== 'recovery')
      navigate('/', { replace: true })
  }, [status, mode, navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!service) {
      setError(configurationError ?? 'Supabase belum dikonfigurasi.')
      return
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (mode === 'sign-up' || mode === 'recovery') {
      if (password.length < 8) {
        setError('Kata sandi harus memiliki minimal 8 karakter.')
        return
      }
      if (password !== passwordConfirmation) {
        setError('Konfirmasi kata sandi belum sama.')
        return
      }
    }

    setBusy(true)
    try {
      if (mode === 'sign-in') {
        await signIn(normalizedEmail, password)
        navigate('/', { replace: true })
      } else if (mode === 'sign-up') {
        const signedIn = await signUp(normalizedEmail, password)
        if (signedIn) navigate('/', { replace: true })
        else {
          setSuccess(
            'Permintaan pendaftaran diproses. Periksa email untuk instruksi konfirmasi sebelum masuk.',
          )
          setMode('sign-in')
          setPassword('')
          setPasswordConfirmation('')
        }
      } else if (mode === 'reset-request') {
        await requestPasswordReset(normalizedEmail)
        setSuccess(
          'Jika email terdaftar, tautan pemulihan akan dikirim ke kotak masuk.',
        )
      } else {
        await updatePassword(password)
        setSuccess(
          'Kata sandi berhasil diperbarui. Kamu sudah dapat melanjutkan.',
        )
        setPassword('')
        setPasswordConfirmation('')
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Permintaan belum berhasil. Periksa koneksi lalu coba lagi.',
      )
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'sign-in'
      ? 'Selamat datang kembali'
      : mode === 'sign-up'
        ? 'Buat akun MoodTask'
        : mode === 'reset-request'
          ? 'Pulihkan akses akun'
          : 'Buat kata sandi baru'

  return (
    <section className="auth-page">
      <Link className="auth-back-link" to="/">
        <ArrowLeft size={15} /> Kembali ke MoodTask
      </Link>
      <div className="auth-card">
        <div className="auth-mark" aria-hidden="true">
          <Sparkles size={20} />
        </div>
        <PageIntro
          eyebrow="AKUN MOODTASK"
          title={title}
          description={
            mode === 'recovery'
              ? 'Pilih kata sandi baru untuk melanjutkan menggunakan akunmu.'
              : 'Simpan tugas dengan aman dan lanjutkan ritmemu di perangkat lain.'
          }
        />

        {!service && (
          <div className="auth-config-notice" role="status">
            <KeyRound size={17} />
            <span>
              {configurationError ??
                'Hubungkan project Supabase untuk mengaktifkan akun.'}{' '}
              Lihat petunjuk setup di README.
            </span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode !== 'recovery' && (
            <label className="form-field">
              <span>Email</span>
              <div className="auth-input-wrap">
                <Mail size={16} aria-hidden="true" />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nama@email.com"
                />
              </div>
            </label>
          )}
          {mode !== 'reset-request' && (
            <>
              <label className="form-field">
                <span>
                  {mode === 'recovery' ? 'Kata sandi baru' : 'Kata sandi'}
                </span>
                <div className="auth-input-wrap">
                  <KeyRound size={16} aria-hidden="true" />
                  <input
                    type="password"
                    autoComplete={
                      mode === 'sign-in' ? 'current-password' : 'new-password'
                    }
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimal 8 karakter"
                  />
                </div>
              </label>
              {(mode === 'sign-up' || mode === 'recovery') && (
                <label className="form-field">
                  <span>Ulangi kata sandi</span>
                  <div className="auth-input-wrap">
                    <KeyRound size={16} aria-hidden="true" />
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={passwordConfirmation}
                      onChange={(event) =>
                        setPasswordConfirmation(event.target.value)
                      }
                      placeholder="Ketik ulang kata sandi"
                    />
                  </div>
                </label>
              )}
            </>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="auth-success" role="status">
              {success}
            </p>
          )}

          <button
            className="button button-primary auth-submit"
            type="submit"
            disabled={busy || !service || status === 'loading'}
          >
            {busy
              ? 'Memproses…'
              : mode === 'sign-in'
                ? 'Masuk'
                : mode === 'sign-up'
                  ? 'Buat akun'
                  : mode === 'reset-request'
                    ? 'Kirim tautan pemulihan'
                    : 'Simpan kata sandi baru'}
          </button>
        </form>

        <div className="auth-secondary-actions">
          {mode === 'sign-in' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode('sign-up')
                  setError('')
                  setSuccess('')
                }}
              >
                Buat akun baru
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reset-request')
                  setError('')
                  setSuccess('')
                }}
              >
                Lupa kata sandi?
              </button>
            </>
          )}
          {mode !== 'sign-in' && mode !== 'recovery' && (
            <button
              type="button"
              onClick={() => {
                setMode('sign-in')
                setError('')
                setSuccess('')
              }}
            >
              Kembali ke halaman masuk
            </button>
          )}
        </div>
        <p className="auth-local-note">
          Tugas lokal tetap tersimpan di browser ini sampai migrasi akun
          berhasil diverifikasi.
        </p>
      </div>
    </section>
  )
}
