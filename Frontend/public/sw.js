self.addEventListener('push', event => {
  if (!event.data) return
  const { title, body, id } = event.data.json()
  event.waitUntil((async () => {
    const cache = await caches.open('laundry-notifications-v1')
    const key = new URL('/notification/' + encodeURIComponent(id), self.location.origin)
    if (await cache.match(key)) return
    await self.registration.showNotification(title, { body, tag: id, icon: '/icon-192.png', renotify: false })
    await cache.put(key, new Response('', { headers: { 'X-Delivered-At': String(Date.now()) } }))
    for (const request of await cache.keys()) {
      const record = await cache.match(request)
      if (Date.now() - Number(record.headers.get('X-Delivered-At')) > 86400000) await cache.delete(request)
    }
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => client.url === new URL('/', self.location.origin).href)
    if (existing) await existing.focus()
    else await self.clients.openWindow('/')
  })())
})
