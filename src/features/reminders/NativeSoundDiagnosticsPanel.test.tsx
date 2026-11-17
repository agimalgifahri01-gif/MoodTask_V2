import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NativeSoundDiagnosticsPanel from './NativeSoundDiagnosticsPanel'
import type { NativeSoundDiagnostics } from './ReminderSettingsContext'

const diagnostics: NativeSoundDiagnostics = {
  listenerActive: true,
  eventReceived: true,
  audioUrlStatus: 'failure',
  playbackStatus: 'failure',
  error: 'MP3 gagal dimuat. Periksa koneksi dan preferensi suara.',
}

describe('NativeSoundDiagnosticsPanel', () => {
  it('shows current native sound states and lets the user clear history', () => {
    const onClear = vi.fn()
    render(
      <NativeSoundDiagnosticsPanel
        diagnostics={diagnostics}
        soundId="custom"
        onClear={onClear}
      />,
    )

    expect(screen.getByText('Listener event native Tauri')).toBeTruthy()
    expect(screen.getByText('Event pengingat diterima React')).toBeTruthy()
    expect(screen.getByText('URL MP3')).toBeTruthy()
    expect(screen.getByText('Pemutaran MP3')).toBeTruthy()
    expect(screen.getAllByText('Gagal')).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toContain('MP3 gagal dimuat')

    fireEvent.click(screen.getByRole('button', { name: 'Hapus riwayat diagnostik' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('shows that built-in sounds do not need an uploaded MP3 URL', () => {
    render(
      <NativeSoundDiagnosticsPanel
        diagnostics={diagnostics}
        soundId="momo-chime"
        onClear={vi.fn()}
      />,
    )

    expect(screen.getByText('File suara bawaan')).toBeTruthy()
    expect(screen.getByText('Tidak diperlukan')).toBeTruthy()
    expect(screen.getByText('Pemutaran suara bawaan')).toBeTruthy()
  })
})
