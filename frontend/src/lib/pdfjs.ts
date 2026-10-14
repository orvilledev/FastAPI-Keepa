/**
 * Single entry point for PDF.js. Always import PDF.js from here, never from 'pdfjs-dist' directly.
 *
 * The desktop app runs on Electron's Chromium, which is older than the newest Chrome. The default
 * PDF.js build calls very new JavaScript methods (Uint8Array.toHex, Map.getOrInsertComputed, ...) and
 * fails on the desktop app with errors like "i.toHex is not a function".
 *
 * The legacy build ships fallbacks for those methods, so one build runs on both desktop and web.
 */
export { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
