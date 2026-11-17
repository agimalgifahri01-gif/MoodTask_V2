/** Opaque, deterministic correlation key shared with the native Rust logger. */
export function reminderTraceId(eventId: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(eventId)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}
