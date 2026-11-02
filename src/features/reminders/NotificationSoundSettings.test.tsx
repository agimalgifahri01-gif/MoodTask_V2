import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReminderRepository } from './ReminderRepository'
import NotificationSoundSettings from './NotificationSoundSettings'
import {
  ReminderSettingsProvider,
  useReminderSettings,
} from './ReminderSettingsContext'
import {
  DEFAULT_NOTIFICATION_SOUND,
  validateNotificationSoundFile,
} from './notificationSound'

const { validateFile, playSound } = vi.hoisted(() => ({
  validateFile: vi.fn(),
  playSound: vi.fn(async () => ({ stop: vi.fn(), onEnded: vi.fn() })),
}))

vi.mock('./notificationSound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notificationSound')>()
  return {
    ...actual,
    validateNotificationSoundFile: validateFile,
    playNotificationSound: playSound,
  }
})

function makeRepository(
  initial = DEFAULT_NOTIFICATION_SOUND,
): ReminderRepository & {
  saveNotificationSoundPreference: ReturnType<typeof vi.fn>
  uploadNotificationSound: ReturnType<typeof vi.fn>
  removeNotificationSound: ReturnType<typeof vi.fn>
} {
  return {
    list: async () => [],
    saveReminder: async () => {
      throw new Error('Not used in sound settings tests')
    },
    removeReminder: async () => {},
    savePushSubscription: async () => {},
    removePushSubscription: async () => {},
    getNotificationSoundPreference: async () => initial,
    saveNotificationSoundPreference: vi.fn(async () => {}),
    uploadNotificationSound: vi.fn(async () => 'user-a/new-sound.mp3'),
    getNotificationSoundUrl: async () => 'https://storage.example/signed-audio',
    removeNotificationSound: vi.fn(async () => {}),
  }
}

function Content() {
  const settings = useReminderSettings()
  if (settings.soundLoading) return <p>Memuat preferensi</p>
  return <NotificationSoundSettings settings={settings} />
}

function SettingsWithProvider({
  repository,
}: {
  repository: ReminderRepository
}) {
  return (
    <ReminderSettingsProvider repository={repository}>
      <Content />
    </ReminderSettingsProvider>
  )
}

describe('NotificationSoundSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('previews and saves a selected built-in sound', async () => {
    const repository = makeRepository()
    render(<SettingsWithProvider repository={repository} />)
    await screen.findByRole('heading', { name: 'Suara notifikasi' })

    fireEvent.click(screen.getByRole('radio', { name: 'Lonceng lembut' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dengarkan' }))
    await waitFor(() =>
      expect(playSound).toHaveBeenCalledWith('soft-bell', null),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hentikan pratinjau' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan pilihan' }))

    await waitFor(() =>
      expect(repository.saveNotificationSoundPreference).toHaveBeenCalledWith({
        soundId: 'soft-bell',
        muted: false,
        objectPath: null,
        fileName: null,
      }),
    )
    expect((await screen.findByRole('status')).textContent).toContain(
      'Pengaturan suara notifikasi berhasil disimpan.',
    )
  })

  it('validates, previews, and stores a custom uploaded sound', async () => {
    const repository = makeRepository()
    validateFile.mockResolvedValueOnce({
      contentType: 'audio/mpeg',
      extension: 'mp3',
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(
      'blob:http://localhost/preview',
    )
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    render(<SettingsWithProvider repository={repository} />)
    await screen.findByRole('heading', { name: 'Suara notifikasi' })

    const file = new File(['audio bytes'], 'momo-tone.mp3', {
      type: 'audio/mpeg',
    })
    fireEvent.change(screen.getByLabelText('Unggah suara sendiri'), {
      target: { files: [file] },
    })
    expect(await screen.findByText(/momo-tone\.mp3/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dengarkan' }))
    await waitFor(() =>
      expect(playSound).toHaveBeenCalledWith(
        'custom',
        'blob:http://localhost/preview',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hentikan pratinjau' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan pilihan' }))

    await waitFor(() =>
      expect(repository.uploadNotificationSound).toHaveBeenCalledWith(
        file,
        'audio/mpeg',
        'mp3',
      ),
    )
    expect(repository.saveNotificationSoundPreference).toHaveBeenCalledWith({
      soundId: 'custom',
      muted: false,
      objectPath: 'user-a/new-sound.mp3',
      fileName: 'momo-tone.mp3',
    })
    expect(
      await screen.findByText(/suara notifikasi berhasil disimpan/i),
    ).toBeTruthy()
    expect(validateNotificationSoundFile).toHaveBeenCalledWith(file)
  })

  it('keeps the persisted sound unchanged when the selected file is invalid', async () => {
    const repository = makeRepository()
    validateFile.mockRejectedValueOnce(new Error('Format tidak didukung.'))
    render(<SettingsWithProvider repository={repository} />)
    await screen.findByRole('heading', { name: 'Suara notifikasi' })
    fireEvent.change(screen.getByLabelText('Unggah suara sendiri'), {
      target: {
        files: [new File(['image'], 'bad.png', { type: 'image/png' })],
      },
    })

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Format tidak didukung.',
    )
    expect(repository.saveNotificationSoundPreference).not.toHaveBeenCalled()
    expect(repository.uploadNotificationSound).not.toHaveBeenCalled()
  })

  it('keeps the previous choice when saving an uploaded sound fails', async () => {
    const repository = makeRepository()
    repository.saveNotificationSoundPreference.mockRejectedValueOnce(
      new Error('Penyimpanan gagal.'),
    )
    validateFile.mockResolvedValueOnce({
      contentType: 'audio/mpeg',
      extension: 'mp3',
    })
    render(<SettingsWithProvider repository={repository} />)
    await screen.findByRole('heading', { name: 'Suara notifikasi' })

    const file = new File(['audio bytes'], 'failed-upload.mp3', {
      type: 'audio/mpeg',
    })
    fireEvent.change(screen.getByLabelText('Unggah suara sendiri'), {
      target: { files: [file] },
    })
    await screen.findByText(/failed-upload\.mp3/)
    fireEvent.click(screen.getByRole('button', { name: 'Simpan pilihan' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Pilihan suara sebelumnya tetap digunakan.',
    )
    expect(repository.removeNotificationSound).toHaveBeenCalledWith(
      'user-a/new-sound.mp3',
    )
    expect(
      (screen.getByRole('radio', { name: 'Lonceng Momo' }) as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(screen.queryByText(/failed-upload\.mp3/)).toBeNull()
  })

  it('removes the saved upload when returning to a built-in sound', async () => {
    const repository = makeRepository({
      soundId: 'custom',
      muted: false,
      objectPath: 'user-a/old.mp3',
      fileName: 'old.mp3',
    })
    render(<SettingsWithProvider repository={repository} />)
    await screen.findByRole('radio', { name: 'Suara unggahan' })
    fireEvent.click(
      screen.getByRole('button', { name: 'Kembali ke suara bawaan' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Simpan pilihan' }))

    await waitFor(() =>
      expect(repository.saveNotificationSoundPreference).toHaveBeenCalledWith({
        ...DEFAULT_NOTIFICATION_SOUND,
      }),
    )
    await waitFor(() =>
      expect(repository.removeNotificationSound).toHaveBeenCalledWith(
        'user-a/old.mp3',
      ),
    )
  })
})
