import { describe, expect, it } from 'vitest'
import { reminderTraceId } from './reminderTrace'

describe('reminder trace ID', () => {
  it('matches the native FNV-1a 64-bit correlation format', () => {
    expect(reminderTraceId('hello')).toBe('a430d84680aabd0b')
  })
})
