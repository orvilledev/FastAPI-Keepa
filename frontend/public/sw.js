const SW_VERSION = 'v12'
const STATIC_CACHE = `msw-overwatch-static-${SW_VERSION}`
const RUNTIME_CACHE = `msw-overwatch-runtime-${SW_VERSION}`
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/app-icon.svg', '/favicon.svg', '/orbit-logo.svg']

function expectedContentType(pathname) {
  if (pathname.endsWith('.css')) return 'text/css'
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return 'javascript'
  return null
}

function isCacheableAssetResponse(response, pathname) {
  if (!response || !response.ok) return false
  if (response.type !== 'basic' && response.type !== 'cors') return false

  const expected = expectedContentType(pathname)
  if (!expected) return true

  const contentType = response.headers.get('content-type') || ''
  return contentType.includes(expected)
}

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
      /\.(js|css|png|jpg|jpeg|svg|webp|ico|woff2?|ttf|eot|mjs)$/.test(url.pathname))

  if (!isStaticAsset) return

  const isScriptOrStyle = /\.(css|js|mjs)$/.test(url.pathname)

  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) => {
      const putIfValid = (response) => {
        if (isCacheableAssetResponse(response, url.pathname)) {
          cache.put(request, response.clone())
        }
        return response
      }

      // CSS/JS: network-first so edge challenges or deploys cannot leave a stale shell.
      if (isScriptOrStyle) {
        return fetch(request)
          .then((networkResponse) => putIfValid(networkResponse))
          .catch(() =>
            cache.match(request).then((cachedResponse) => {
              if (cachedResponse && isCacheableAssetResponse(cachedResponse, url.pathname)) {
                return cachedResponse
              }
              return Response.error()
            })
          )
      }

      // Other static assets: stale-while-revalidate.
      return cache.match(request).then((cachedResponse) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => putIfValid(networkResponse))
          .catch(() => null)

        if (cachedResponse) {
          return cachedResponse
        }

        return networkFetch.then((response) => response || Response.error())
      })
    })
  )
})
