const SW_VERSION = 'v3'
const STATIC_CACHE = `msw-overwatch-static-${SW_VERSION}`
const RUNTIME_CACHE = `msw-overwatch-runtime-${SW_VERSION}`
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/app-icon.svg', '/favicon.svg', '/orbit-logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.registration.clearAppBadge?.())
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.registration.clearAppBadge?.())
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION }))
      })
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  // Never cache API responses; always hit the network for fresh data.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return

  // App navigation: network first with cached shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((response) => response || caches.match('/')))
    )
    return
  }

  const isStaticAsset =
    sameOrigin &&
    (url.pathname.startsWith('/assets/') ||
      /\.(js|css|png|jpg|jpeg|svg|webp|ico|woff2?|ttf|eot)$/.test(url.pathname))

  if (!isStaticAsset) return

  // Static assets: stale-while-revalidate with runtime cache.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(request).then((cachedResponse) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse.ok && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
              cache.put(request, networkResponse.clone())
            }
            return networkResponse
          })
          .catch(() => null)

        if (cachedResponse) {
          return cachedResponse
        }

        return networkFetch.then((response) => response || Response.error())
      })
    )
  )
})
