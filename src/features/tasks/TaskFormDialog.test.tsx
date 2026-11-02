import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReminderRepository } from '../reminders/ReminderRepository'
import { ReminderSettingsProvider } from '../reminders/ReminderSettingsContext'
import TaskFormDialog from './TaskFormDialog'

const reminderRepository: ReminderRepository = {
  list: async () => [],
  saveReminder: async (taskId, minutesBefore, enabled) => ({
    id: 'reminder-1',
    taskId,
    minutesBefore,
    enabled,
    createdAt: new Date().toISOString(),
  }),
  removeReminder: async () => {},
  getPushSubscriptionOrigin: async () => null,
  savePushSubscription: async () => {},
  removePushSubscription: async () => {},
  getNotificationSoundPreference: async () => null,
  saveNotificationSoundPreference: async () => {},
  uploadNotificationSound: async () => 'user-a/sound.mp3',
  getNotificationSoundUrl: async () => 'https://storage.example/sound',
  removeNotificationSound: async () => {},
}

describe('TaskFormDialog reminders', () => {
  it('passes a custom minute duration and shows the calculated summary', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ReminderSettingsProvider repository={reminderRepository}>
        <TaskFormDialog open onClose={() => {}} onSave={onSave} />
      </ReminderSettingsProvider>,
    )

    await screen.findByText(/Browser ini tidak mendukung push/)

    fireEvent.change(screen.getByLabelText(/Judul tugas/), {
      target: { value: 'Rapat tim' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Aktifkan pengingat untuk tugas ini',
      }),
    )
    for (const label of [
      'Durasi pengingat dalam hari',
      'Durasi pengingat dalam jam',
      'Durasi pengingat dalam menit',
    ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('')
    }
    fireEvent.change(screen.getByLabelText('Durasi pengingat dalam menit'), {
      target: { value: '45' },
    })
    expect(
      screen.getByText(/Momo akan mengingatkan 45 menit sebelum deadline/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Rapat tim' })
    expect(onSave.mock.calls[0][1]).toBe(45)
  })

  it('requires a duration when reminders are enabled and rejects past schedules', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ReminderSettingsProvider repository={reminderRepository}>
        <TaskFormDialog open onClose={() => {}} onSave={onSave} />
      </ReminderSettingsProvider>,
    )
    await screen.findByText(/Browser ini tidak mendukung push/)
    fireEvent.change(screen.getByLabelText(/Judul tugas/), {
      target: { value: 'Tugas dengan pengingat' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Aktifkan pengingat untuk tugas ini',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Isi durasi pengingat',
    )
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Durasi pengingat dalam menit'), {
      target: { value: '60' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Pengingat harus jatuh setelah waktu mulai tugas',
    )
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps reminders optional in local mode and saves the task without one', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<TaskFormDialog open onClose={() => {}} onSave={onSave} />)

    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Aktifkan pengingat untuk tugas ini',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByLabelText(/Judul tugas/), {
      target: { value: 'Catat ide' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tugas' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0][1]).toBeNull()
  })
})
