const CACHE_NAME = 'msw-overwatch-v2'
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/app-icon.svg', '/favicon.svg', '/orbit-logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.registration.clearAppBadge?.())
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.registration.clearAppBadge?.())
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Never cache API responses; always hit the network for fresh data.
  if (url.pathname.startsWith('/api/')) return

  // App navigation: network first with cached shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((response) => response || caches.match('/')))
    )
    return
  }

  // Static assets: cache first, then network.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse
      return fetch(request).then((networkResponse) => {
        const copy = networkResponse.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return networkResponse
      })
    })
  )
})
