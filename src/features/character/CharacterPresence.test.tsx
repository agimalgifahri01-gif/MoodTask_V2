import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CharacterPresence from './CharacterPresence'
import { getTaskMood, taskMoodLabels, type Task } from '../tasks/domain'
import { decodeStoredTasks } from '../tasks/LocalStorageTaskRepository'

describe('CharacterPresence', () => {
  it('adapts a domain mood and character catalog entry to the renderer', () => {
    const markup = renderToStaticMarkup(
      <CharacterPresence mood="happy" characterId="momo" />,
    )
    expect(markup).toContain('data-expression="happy"')
    expect(markup).toContain('aria-label="Momo, bahagia"')
    expect(markup).toContain('fill="#f3b36f"')
  })

  it.each([
    ['calm', 'Santai'],
    ['alert', 'Waspada'],
    ['anxious', 'Cemas'],
    ['panic', 'Panik'],
    ['late', 'Terlambat'],
    ['happy', 'Bahagia'],
  ] as const)(
    'keeps the %s label and SVG expression in sync',
    (mood, label) => {
      const markup = renderToStaticMarkup(<CharacterPresence mood={mood} />)
      expect(markup).toContain(`data-expression="${mood}"`)
      expect(markup).toContain(`aria-label="Momo, ${label.toLowerCase()}"`)
      expect(taskMoodLabels[mood]).toBe(label)
    },
  )

  it('renders the calm label and expression for a newly created 90% task', () => {
    const task: Task = {
      id: 'new-task',
      title: 'Tugas baru',
      description: '',
      startAt: '2026-10-22T00:00:00.000Z',
      deadlineAt: '2026-10-22T01:00:00.000Z',
      priority: 'medium',
      status: 'active',
      createdAt: '2026-10-22T00:06:00.000Z',
      updatedAt: '2026-10-22T00:06:00.000Z',
      completedAt: null,
    }
    const mood = getTaskMood(task, Date.parse('2026-10-22T00:06:00.000Z'))!
    const markup = renderToStaticMarkup(<CharacterPresence mood={mood} />)

    expect(mood).toBe('calm')
    expect(markup).toContain('aria-label="Momo, santai"')
    expect(markup).toContain('data-expression="calm"')
  })

  it('recomputes a restored legacy task mood without using stored progress', () => {
    const [task] = decodeStoredTasks(
      JSON.stringify([
        {
          id: 'restored-task',
          title: 'Tugas tersimpan',
          description: '',
          startAt: '2026-10-22T00:00:00.000Z',
          deadlineAt: '2026-10-22T01:00:00.000Z',
          priority: 'medium',
          status: 'active',
          progressPercent: 1,
          createdAt: '2026-10-22T00:00:00.000Z',
          updatedAt: '2026-10-22T00:00:00.000Z',
          completedAt: null,
        },
      ]),
    )
    const mood = getTaskMood(task, Date.parse('2026-10-22T00:06:00.000Z'))!
    const markup = renderToStaticMarkup(<CharacterPresence mood={mood} />)

    expect(mood).toBe('calm')
    expect(markup).toContain('aria-label="Momo, santai"')
    expect(markup).toContain('data-expression="calm"')
    expect(task).not.toHaveProperty('progressPercent')
  })

  it('falls back to the base character for an unknown catalog id', () => {
    const markup = renderToStaticMarkup(
      <CharacterPresence mood="calm" characterId="future-character" />,
    )
    expect(markup).toContain('aria-label="Momo, santai"')
  })
})
