import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from './domain'
import TaskCard from './TaskCard'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-card-test',
    title: 'Tugas dengan deadline',
    description: 'Catatan singkat',
    startAt: '2026-10-22T08:00:00.000Z',
    deadlineAt: '2026-10-22T10:00:00.000Z',
    priority: 'high',
    status: 'active',
    createdAt: '2026-10-22T08:00:00.000Z',
    updatedAt: '2026-10-22T08:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

describe('TaskCard', () => {
  it('shows status, priority, deadline timing and matching Momo mood', () => {
    const now = Date.parse('2026-10-22T09:00:00.000Z')
    const onOpen = vi.fn()
    const onStatusChange = vi.fn()
    const { container } = render(
      <TaskCard
        task={makeTask()}
        now={now}
        onOpen={onOpen}
        onStatusChange={onStatusChange}
      />,
    )

    expect(screen.getByText('Tugas dengan deadline')).toBeTruthy()
    expect(screen.getByText('Aktif')).toBeTruthy()
    expect(screen.getByText('Tinggi')).toBeTruthy()
    expect(screen.getByText('Cemas')).toBeTruthy()
    expect(
      container.querySelector('svg[data-expression="anxious"]'),
    ).toBeTruthy()
    expect(screen.getByText(/1 jam lagi/)).toBeTruthy()
    expect(screen.getByText(/22 Okt 2026/)).toBeTruthy()
  })

  it('marks overdue tasks with text and a visual indicator, not color alone', () => {
    const { container } = render(
      <TaskCard
        task={makeTask()}
        now={Date.parse('2026-10-22T10:30:00.000Z')}
        onOpen={() => {}}
        onStatusChange={() => {}}
      />,
    )

    expect(container.querySelector('.task-card-attention')).toBeTruthy()
    expect(screen.getByText(/Terlambat 30 menit/)).toBeTruthy()
    expect(screen.getByText('Terlambat')).toBeTruthy()
    expect(container.querySelector('svg[data-expression="late"]')).toBeTruthy()
  })
})
