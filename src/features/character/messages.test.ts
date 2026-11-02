import { describe, expect, it } from 'vitest'
import { getCharacterMessage } from './messages'

describe('character mood messages', () => {
  it.each(['calm', 'alert', 'anxious', 'panic', 'late', 'happy'] as const)(
    'provides a stable, non-empty message for %s',
    (mood) => {
      const first = getCharacterMessage(mood, 'task-123')
      expect(first.trim().length).toBeGreaterThan(0)
      expect(getCharacterMessage(mood, 'task-123')).toBe(first)
    },
  )

  it('selects a message independently for different task seeds', () => {
    expect(getCharacterMessage('calm', 'task-1')).not.toBe(
      getCharacterMessage('calm', 'task-2'),
    )
  })
})
