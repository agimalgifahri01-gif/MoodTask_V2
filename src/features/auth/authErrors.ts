export function toFriendlyAuthError(message: string): Error {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) {
    return new Error('Email atau password tidak sesuai.')
  }
  if (normalized.includes('already registered')) {
    return new Error('Email ini sudah terdaftar. Silakan masuk.')
  }
  if (normalized.includes('email not confirmed')) {
    return new Error('Konfirmasi email terlebih dahulu sebelum masuk.')
  }
  if (normalized.includes('password') && normalized.includes('short')) {
    return new Error('Kata sandi terlalu pendek. Gunakan minimal 8 karakter.')
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return new Error(
      'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
    )
  }
  if (
    normalized.includes('fetch') ||
    normalized.includes('network') ||
    normalized.includes('offline')
  ) {
    return new Error(
      'Tidak dapat terhubung. Periksa koneksi internet lalu coba lagi.',
    )
  }
  return new Error(
    'Permintaan akun belum berhasil. Periksa data lalu coba lagi.',
  )
}
