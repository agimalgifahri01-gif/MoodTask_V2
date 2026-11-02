import { describe, expect, it } from 'vitest'
import { validateSupabaseUrl } from './supabaseUrl'

describe('Supabase URL validation', () => {
  it('accepts the standard HTTPS hosted endpoint', () => {
    expect(
      validateSupabaseUrl('https://abcdefghijklmnopqrst.supabase.co'),
    ).toBeNull()
  })

  it('rejects malformed URLs without echoing the supplied value', () => {
    expect(validateSupabaseUrl('not a URL')).toBe(
      'VITE_SUPABASE_URL bukan URL yang valid.',
    )
  })

  it('requires HTTPS for hosted projects', () => {
    expect(
      validateSupabaseUrl('http://abcdefghijklmnopqrst.supabase.co'),
    ).toContain('HTTPS')
  })

  it('rejects hosts outside the supported Supabase endpoints', () => {
    expect(validateSupabaseUrl('https://supabase-attacker.example')).toContain(
      'Host harus',
    )
  })

  it('rejects embedded credentials, custom hosted ports, and URL paths', () => {
    expect(
      validateSupabaseUrl(
        'https://name:password@abcdefghijklmnopqrst.supabase.co',
      ),
    ).toContain('username atau password')
    expect(
      validateSupabaseUrl('https://abcdefghijklmnopqrst.supabase.co:8443'),
    ).toContain('port khusus')
    expect(
      validateSupabaseUrl('https://abcdefghijklmnopqrst.supabase.co/rest/v1'),
    ).toContain('URL root')
  })

  it('accepts the loopback HTTP URL used by local Supabase development', () => {
    expect(validateSupabaseUrl('http://127.0.0.1:54321')).toBeNull()
    expect(validateSupabaseUrl('http://localhost:54321')).toBeNull()
  })

  it('does not accept insecure HTTP on a non-loopback host', () => {
    expect(validateSupabaseUrl('http://supabase-attacker.example')).toContain(
      'Host harus',
    )
  })
})
