const moodLabels = {
  calm: 'Santai',
  alert: 'Waspada',
  anxious: 'Cemas',
  panic: 'Panik',
  late: 'Terlambat',
  happy: 'Bahagia',
}

const allowedMoods = new Set(Object.keys(moodLabels))
const taskIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload
      try {
        payload = event.data ? event.data.json() : {}
      } catch {
        payload = {}
      }

      const mood = allowedMoods.has(payload.mood) ? payload.mood : 'calm'
      const taskTitle =
        typeof payload.body === 'string'
          ? payload.body.slice(0, 500)
          : 'Ada pengingat baru untuk tugasmu.'
      const taskId =
        typeof payload.taskId === 'string' && taskIdPattern.test(payload.taskId)
          ? payload.taskId
          : null
      const requestedTag =
        typeof payload.tag === 'string' && payload.tag.length <= 160
          ? payload.tag.replace(/[^a-zA-Z0-9_-]/g, '')
          : ''

      const openClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const sameOriginClients = openClients.filter(
        (client) => new URL(client.url).origin === self.location.origin,
      )
      const soundClient =
        sameOriginClients.find((client) => client.focused) ??
        sameOriginClients.find(
          (client) => client.visibilityState === 'visible',
        ) ??
        sameOriginClients[0]
      if (soundClient) {
        soundClient.postMessage({
          type: 'MOODTASK_REMINDER_RECEIVED',
          eventId: requestedTag || `moodtask-${taskId || 'reminder'}`,
        })
      }

      await self.registration.showNotification(`Momo · ${moodLabels[mood]}`, {
        body: taskTitle,
        icon: `/momo/${mood}.svg`,
        badge: '/momo/calm.svg',
        tag: requestedTag || `moodtask-${taskId || 'reminder'}`,
        renotify: false,
        data: { taskId },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const taskId = event.notification.data?.taskId
      const destination = new URL('/tasks', self.location.origin)
      if (typeof taskId === 'string' && taskIdPattern.test(taskId)) {
        destination.searchParams.set('open', taskId)
      }

      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        if ('navigate' in client) await client.navigate(destination.href)
        await client.focus()
        return
      }
      await self.clients.openWindow(destination.href)
    })(),
  )
})
