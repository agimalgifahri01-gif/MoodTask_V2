import { useEffect, useState } from 'react'

export function useCurrentTime(intervalMilliseconds = 30_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const update = () => setNow(Date.now())
    const interval = window.setInterval(update, intervalMilliseconds)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [intervalMilliseconds])

  return now
}
