const HOSTED_SUPABASE_HOST = /^[a-z0-9]{20}\.supabase\.co$/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Returns a safe, user-facing configuration error, or null for supported URLs. */
export function validateSupabaseUrl(value: string): string | null {
  if (!value.trim()) return 'VITE_SUPABASE_URL wajib diisi.'

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'VITE_SUPABASE_URL bukan URL yang valid.'
  }

  if (url.username || url.password) {
    return 'URL Supabase tidak boleh menyertakan username atau password.'
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return 'Gunakan URL root Supabase tanpa path, query, atau fragment.'
  }

  const host = url.hostname.toLowerCase()
  if (HOSTED_SUPABASE_HOST.test(host)) {
    if (url.protocol !== 'https:') {
      return 'Project Supabase hosted harus menggunakan HTTPS.'
    }
    if (url.port) {
      return 'URL project Supabase hosted tidak boleh menggunakan port khusus.'
    }
    return null
  }

  if (LOCAL_HOSTS.has(host)) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Supabase lokal harus menggunakan HTTP atau HTTPS.'
    }
    return null
  }

  return 'Host harus berupa endpoint Supabase hosted atau alamat loopback lokal.'
}
