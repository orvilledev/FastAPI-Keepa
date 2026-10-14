/**
 * PDF.js running its worker on the page itself (no separate worker file to load).
 * Label Center uses this so previews and Zebra jobs work the same on the web and in the desktop app.
 * Same legacy build as ./pdfjs, so the desktop app's older Chromium is covered.
 */
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'

export { getDocument } from './pdfjs'
