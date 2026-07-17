const SW_VERSION = 'v13'
const STATIC_CACHE = `msw-overwatch-static-${SW_VERSION}`
const RUNTIME_CACHE = `msw-overwatch-runtime-${SW_VERSION}`
// Do NOT precache index.html / "/" — hashed asset URLs change every deploy.
// Serving a stale shell is the main cause of blank white screens after updates.
const APP_SHELL_FILES = ['/manifest.webmanifest', '/app-icon.svg', '/favicon.svg', '/orbit-logo.svg']

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
      .then(() =>
        // Drop any previously cached HTML shells that may point at deleted chunks.
        caches.open(STATIC_CACHE).then((cache) =>
          Promise.all([cache.delete('/'), cache.delete('/index.html')])
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

  // App navigation: always prefer network. Offline fallback is a tiny HTML page,
  // not a cached index that may reference deleted /assets/*.js chunks.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(
          () =>
            new Response(
              `<!doctype html><html><head><meta charset="utf-8"><title>MSW Overwatch</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fff;color:#111}
              button{margin-top:12px;padding:10px 16px;font-size:14px;cursor:pointer}</style></head>
              <body><div style="text-align:center;max-width:28rem;padding:1.5rem">
              <h1 style="font-size:1.25rem">You're offline</h1>
              <p>Reconnect, then reload. If the app stays blank after an update, clear site data for this origin.</p>
              <button type="button" onclick="location.reload()">Reload</button>
              </div></body></html>`,
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
        )
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

      // CSS/JS: network-first so deploys cannot leave a stale shell.
      if (isScriptOrStyle) {
        return fetch(request)
          .then((networkResponse) => {
            // Never treat SPA HTML fallback as a JS/CSS asset.
            if (!isCacheableAssetResponse(networkResponse, url.pathname)) {
              return Response.error()
            }
            return putIfValid(networkResponse)
          })
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
