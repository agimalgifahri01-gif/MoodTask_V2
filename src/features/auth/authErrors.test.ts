import { describe, expect, it } from 'vitest'
import { toFriendlyAuthError } from './authErrors'

describe('auth error messages', () => {
  it('maps common credential and network failures without exposing service text', () => {
    expect(toFriendlyAuthError('Invalid login credentials').message).toBe(
      'Email atau password tidak sesuai.',
    )
    expect(toFriendlyAuthError('Failed to fetch').message).toContain(
      'Periksa koneksi internet',
    )
    expect(
      toFriendlyAuthError('Internal provider stack trace').message,
    ).not.toContain('provider stack trace')
  })
})
