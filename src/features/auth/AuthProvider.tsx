import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { User, SupabaseClient } from '@supabase/supabase-js'
import { AuthContext, type AuthStatus } from './AuthContext'
import type { AuthService } from './AuthService'
import { getSupabaseClient, configurationError } from './supabaseClient'
import { SupabaseAuthService } from './AuthService'
import { toFriendlyAuthError } from './authErrors'

type Props = {
  children: ReactNode
  service?: AuthService | null
  configError?: string | null
}

function errorMessage(caught: unknown): string {
  const raw =
    caught instanceof Error ? caught.message : 'Permintaan belum berhasil.'
  return toFriendlyAuthError(raw).message
}

function friendlyError(caught: unknown): Error {
  return new Error(errorMessage(caught), { cause: caught })
}

export function AuthProvider({
  children,
  service,
  configError = configurationError,
}: Props) {
  const [activeService, setActiveService] = useState<AuthService | null>(
    service ?? null,
  )
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [status, setStatus] = useState<AuthStatus>(() =>
    service !== undefined
      ? service
        ? 'loading'
        : 'unconfigured'
      : configError
        ? 'unconfigured'
        : 'loading',
  )

  useEffect(() => {
    if (service !== undefined || configError) return
    let active = true
    void getSupabaseClient()
      .then((nextClient) => {
        if (!active || !nextClient) return
        setClient(nextClient)
        setActiveService(new SupabaseAuthService(nextClient))
      })
      .catch((caught: unknown) => {
        if (!active) return
        setStatus('unavailable')
        setAuthError(errorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [service, configError])

  useEffect(() => {
    if (!activeService) return
    let active = true
    let authEventSeen = false
    const unsubscribe = activeService.subscribe((nextUser) => {
      if (!active) return
      authEventSeen = true
      setUser(nextUser)
      setStatus(nextUser ? 'signed-in' : 'signed-out')
      setAuthError(null)
    })

    void activeService
      .getUser()
      .then((initialUser) => {
        if (!active || authEventSeen) return
        setUser(initialUser)
        setStatus(initialUser ? 'signed-in' : 'signed-out')
      })
      .catch((caught: unknown) => {
        if (!active || authEventSeen) return
        setUser(null)
        setStatus('unavailable')
        setAuthError(errorMessage(caught))
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [activeService])

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!activeService)
        throw new Error(configError ?? 'Supabase belum dikonfigurasi.')
      try {
        await activeService.signIn(email, password)
      } catch (caught) {
        throw friendlyError(caught)
      }
    },
    [activeService, configError],
  )

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!activeService)
        throw new Error(configError ?? 'Supabase belum dikonfigurasi.')
      try {
        return await activeService.signUp(email, password)
      } catch (caught) {
        throw friendlyError(caught)
      }
    },
    [activeService, configError],
  )

  const signOut = useCallback(async () => {
    if (!activeService)
      throw new Error(configError ?? 'Supabase belum dikonfigurasi.')
    try {
      await activeService.signOut()
    } catch (caught) {
      throw friendlyError(caught)
    }
  }, [activeService, configError])

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!activeService)
        throw new Error(configError ?? 'Supabase belum dikonfigurasi.')
      try {
        await activeService.requestPasswordReset(email)
      } catch (caught) {
        throw friendlyError(caught)
      }
    },
    [activeService, configError],
  )

  const updatePassword = useCallback(
    async (password: string) => {
      if (!activeService)
        throw new Error(configError ?? 'Supabase belum dikonfigurasi.')
      try {
        await activeService.updatePassword(password)
      } catch (caught) {
        throw friendlyError(caught)
      }
    },
    [activeService, configError],
  )

  const value = useMemo(
    () => ({
      status,
      user,
      authError,
      configurationError: configError,
      service: activeService,
      client,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
    }),
    [
      status,
      user,
      authError,
      configError,
      activeService,
      client,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
