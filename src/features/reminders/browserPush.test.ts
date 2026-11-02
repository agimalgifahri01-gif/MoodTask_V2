import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  decodeVapidPublicKey,
  getPushCapability,
  requestBrowserPushSubscription,
} from './browserPush'

const base = {
  notificationAvailable: true,
  serviceWorkerAvailable: true,
  pushManagerAvailable: true,
  permission: 'default' as const,
  publicKeyAvailable: true,
}

describe('browser push capability', () => {
  it('reports unsupported browser APIs without asking for permission', () => {
    expect(getPushCapability({ ...base, pushManagerAvailable: false })).toBe(
      'unsupported',
    )
  })

  it('reports denied permission and missing server configuration', () => {
    expect(getPushCapability({ ...base, permission: 'denied' })).toBe('denied')
    expect(getPushCapability({ ...base, publicKeyAvailable: false })).toBe(
      'not-configured',
    )
  })

  it('distinguishes a gesture-required prompt from permission already granted', () => {
    expect(getPushCapability(base)).toBe('needs-permission')
    expect(getPushCapability({ ...base, permission: 'granted' })).toBe('ready')
  })

  it('decodes an uncompressed P-256 VAPID public key', () => {
    const raw = new Uint8Array(65)
    raw[0] = 4
    const key = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const decoded = decodeVapidPublicKey(key)
    expect(decoded).toHaveLength(65)
    expect(decoded[0]).toBe(4)
  })

  it('rejects placeholder and malformed public keys', () => {
    expect(() => decodeVapidPublicKey('YOUR_VAPID_PUBLIC_KEY')).toThrow(
      'Kunci publik notifikasi belum valid.',
    )
    expect(() => decodeVapidPublicKey('AA')).toThrow(
      'Kunci publik notifikasi belum valid.',
    )
  })
})

describe('requestBrowserPushSubscription error handling', () => {
  const originalSecure = window.isSecureContext
  const originalPushManager = window.PushManager
  const originalNotification = window.Notification

  afterEach(() => {
    vi.restoreAllMocks()
    window.isSecureContext = originalSecure
    window.PushManager = originalPushManager
    window.Notification = originalNotification
  })

  function setupSupportedEnvironment(
    permission: NotificationPermission = 'default',
  ) {
    window.isSecureContext = true
    window.PushManager = class PushManager {} as unknown as typeof PushManager
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn(),
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: vi.fn(),
          },
        }),
      },
      configurable: true,
    })
    window.Notification = {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    } as unknown as typeof Notification
  }

  it('fails with clear Indonesian message when push is unsupported', async () => {
    // In unmocked jsdom, serviceWorker/PushManager is missing
    await expect(requestBrowserPushSubscription('valid-key')).rejects.toThrow(
      'Browser ini belum mendukung notifikasi push MoodTask.',
    )
  })

  it('fails with clear message when public key is not configured', async () => {
    setupSupportedEnvironment()
    await expect(requestBrowserPushSubscription('')).rejects.toThrow(
      'Push belum siap di lingkungan ini karena kunci publik VAPID belum dikonfigurasi.',
    )
  })

  it('fails with clear message when permission is already denied', async () => {
    setupSupportedEnvironment('denied')
    await expect(requestBrowserPushSubscription('valid-key')).rejects.toThrow(
      'Izin notifikasi ditolak. Izinkan notifikasi MoodTask melalui pengaturan browser.',
    )
  })

  it('fails when user denies permission during prompt', async () => {
    setupSupportedEnvironment('default')
    window.Notification.requestPermission = vi.fn().mockResolvedValue('denied')
    await expect(requestBrowserPushSubscription('valid-key')).rejects.toThrow(
      'Izin notifikasi ditolak. Kamu dapat mengubahnya di pengaturan browser.',
    )
  })
})
