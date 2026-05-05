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

## Auto-updates (GitHub Releases)

The packaged app uses **`electron-updater`** and the `build.publish` entry in `package.json` (GitHub `orvilledev/FastAPI-Keepa`). Installed clients poll for updates on startup and about once per day.

**Ship a new desktop version**

1. Bump **`version`** in `frontend/package.json` (semver higher than the last release).
2. Create a **GitHub personal access token** with `repo` scope (for uploads only; keep it secret).
3. From **`frontend`**, with `GH_TOKEN` set in the environment:

   ```bash
   npm run electron:release
   ```

   This builds and runs **`electron-builder --publish always`**, which uploads the installer, `latest.yml`, and blockmap to a **new GitHub Release** for that version. Users on the previous build will be notified when an update is ready (Windows toast via `checkForUpdatesAndNotify`).

For a **local installer only** without publishing to GitHub, keep using `npm run electron:build` and attach artifacts to a release manually—include **`latest.yml`** and the `.exe.blockmap` next to the `.exe` if you want the auto-updater to see that release.

## Notes

- API calls still use `VITE_API_URL`, so keep your backend reachable from desktop clients.
- Security defaults are enabled in `electron/main.cjs`:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
- External links are opened in the system browser, not inside Electron webviews.
