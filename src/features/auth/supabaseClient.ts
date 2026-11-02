import type { SupabaseClient } from '@supabase/supabase-js'
import { validateSupabaseUrl } from './supabaseUrl'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

let configurationError: string | null = null
if (
  !url ||
  !publishableKey ||
  url.includes('YOUR_PROJECT_REF') ||
  publishableKey.includes('YOUR_SUPABASE_PUBLISHABLE_KEY')
) {
  configurationError =
    'Supabase belum dikonfigurasi. Isi URL project dan publishable key di .env.local.'
} else {
  configurationError = validateSupabaseUrl(url)
}

let clientPromise: Promise<SupabaseClient> | null = null

export function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (configurationError) return Promise.resolve(null)
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    }),
  )
  return clientPromise
}

export { configurationError }
