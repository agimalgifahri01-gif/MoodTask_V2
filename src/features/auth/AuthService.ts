import type { User } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthService {
  getUser(): Promise<User | null>
  subscribe(onUser: (user: User | null) => void): () => void
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<boolean>
  signOut(): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
}

export class SupabaseAuthService implements AuthService {
  constructor(private readonly client: SupabaseClient) {}

  async getUser(): Promise<User | null> {
    const { data, error } = await this.client.auth.getUser()
    if (error) throw new Error(error.message)
    return data.user
  }

  subscribe(onUser: (user: User | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION may be only a locally cached token; getUser verifies it.
      if (event === 'INITIAL_SESSION') return
      onUser(session?.user ?? null)
    })
    return () => data.subscription.unsubscribe()
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw new Error(error.message)
  }

  async signUp(email: string, password: string): Promise<boolean> {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw new Error(error.message)
    return data.session !== null
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut()
    if (error) throw new Error(error.message)
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/recovery`,
    })
    if (error) throw new Error(error.message)
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password })
    if (error) throw new Error(error.message)
  }
}
