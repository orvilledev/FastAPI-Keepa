# Electron Desktop App Setup

This project now includes an Electron wrapper for the Vite frontend.

## 1) Install dependencies

```bash
npm install
```

## 2) Run in desktop dev mode

```bash
npm run electron:dev
```

This starts Vite on `http://localhost:5173` and launches Electron.

## 3) Build desktop installer (Windows)

```bash
npm run electron:build
```

This runs:

1. `vite build --mode electron` (uses relative asset paths for `file://` loading)
2. `electron-builder` (creates an NSIS installer)

## Notes

- API calls still use `VITE_API_URL`, so keep your backend reachable from desktop clients.
- Security defaults are enabled in `electron/main.cjs`:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
- External links are opened in the system browser, not inside Electron webviews.
