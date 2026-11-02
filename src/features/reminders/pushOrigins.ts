export const CANONICAL_PUSH_ORIGIN = 'https://mood-task-v2.vercel.app'

export function isCanonicalPushOrigin(origin: string) {
  return origin === CANONICAL_PUSH_ORIGIN
}

export function isPushOriginAllowed(origin: string) {
  return isCanonicalPushOrigin(origin)
}
