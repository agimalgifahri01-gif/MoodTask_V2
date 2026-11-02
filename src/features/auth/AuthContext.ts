import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthService } from './AuthService'

export type AuthStatus =
  'loading' | 'unconfigured' | 'signed-out' | 'signed-in' | 'unavailable'

export type AuthContextValue = {
  status: AuthStatus
  user: User | null
  authError: string | null
  configurationError: string | null
  service: AuthService | null
  client: SupabaseClient | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth harus dipakai di dalam AuthProvider.')
  return context
}
