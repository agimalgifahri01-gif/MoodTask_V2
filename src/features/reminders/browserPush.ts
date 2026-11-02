export type PushCapability =
  'unsupported' | 'denied' | 'not-configured' | 'needs-permission' | 'ready'

export type PushCapabilityInput = {
  notificationAvailable: boolean
  serviceWorkerAvailable: boolean
  pushManagerAvailable: boolean
  permission: NotificationPermission | 'unavailable'
  publicKeyAvailable: boolean
}

export function getPushCapability({
  notificationAvailable,
  serviceWorkerAvailable,
  pushManagerAvailable,
  permission,
  publicKeyAvailable,
}: PushCapabilityInput): PushCapability {
  if (
    !notificationAvailable ||
    !serviceWorkerAvailable ||
    !pushManagerAvailable
  ) {
    return 'unsupported'
  }
  if (permission === 'denied') return 'denied'
  if (!publicKeyAvailable) return 'not-configured'
  return permission === 'granted' ? 'ready' : 'needs-permission'
}

export function getCurrentPushCapability(publicKey: string) {
  const available = typeof window !== 'undefined'
  return getPushCapability({
    notificationAvailable: available && 'Notification' in window,
    serviceWorkerAvailable:
      available && 'serviceWorker' in navigator && window.isSecureContext,
    pushManagerAvailable: available && 'PushManager' in window,
    permission:
      available && 'Notification' in window
        ? Notification.permission
        : 'unavailable',
    publicKeyAvailable: publicKey.trim().length > 0,
  })
}

export function decodeVapidPublicKey(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('Kunci publik notifikasi belum valid.')
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    if (bytes.length !== 65 || bytes[0] !== 4) {
      throw new Error('Invalid application server key length.')
    }
    return bytes
  } catch {
    throw new Error('Kunci publik notifikasi belum valid.')
  }
}

export type BrowserPushSubscription = {
  subscription: PushSubscription
  created: boolean
}

export async function requestBrowserPushSubscription(
  publicKey: string,
): Promise<BrowserPushSubscription> {
  const capability = getCurrentPushCapability(publicKey)
  if (capability === 'unsupported') {
    throw new Error('Browser ini belum mendukung notifikasi push MoodTask.')
  }
  if (capability === 'denied') {
    throw new Error(
      'Izin notifikasi ditolak. Izinkan notifikasi MoodTask melalui pengaturan browser.',
    )
  }
  if (capability === 'not-configured') {
    throw new Error(
      'Push belum siap di lingkungan ini karena kunci publik VAPID belum dikonfigurasi.',
    )
  }

  // This is called directly from an explicit button click; never on page load.
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Izin notifikasi ditolak. Kamu dapat mengubahnya di pengaturan browser.'
        : 'Izin notifikasi belum diberikan.',
    )
  }

  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
  })
  const ready = await navigator.serviceWorker.ready
  const existing = await ready.pushManager.getSubscription()
  if (existing) return { subscription: existing, created: false }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidPublicKey(publicKey),
  })
  return { subscription, created: true }
}

export async function getCurrentBrowserPushSubscription() {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof window === 'undefined' ||
    !window.isSecureContext
  ) {
    return null
  }
  const registration = await navigator.serviceWorker.getRegistration('/')
  return registration?.pushManager.getSubscription() ?? null
}
