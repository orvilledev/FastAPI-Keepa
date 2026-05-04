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

The build regenerates `electron/icon.ico` from `public/app-icon.svg` (Windows `.exe` / window / taskbar icon). To refresh only the icon:

```bash
npm run icons:win
```

```bash
npm run electron:build
```

This runs:

1. `vite build --mode electron` (uses relative asset paths for `file://` loading)
2. `electron-builder` (creates an NSIS installer)

After a successful build, the installer is written next to the web bundle, for example:

`frontend/dist/MSW Overwatch Setup 1.0.0.exe`

(The version in the filename follows `package.json` `version`.)

### Windows: unsigned local builds

This repo disables automatic Windows code signing so builds work without symlink privileges from the `winCodeSign` tool extract (`CSC_IDENTITY_AUTO_DISCOVERY=false` and `build.win.signAndEditExecutable: false`). For production releases you will usually replace that with real code signing.

## Notes

- API calls still use `VITE_API_URL`, so keep your backend reachable from desktop clients.
- Security defaults are enabled in `electron/main.cjs`:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
- External links are opened in the system browser, not inside Electron webviews.
