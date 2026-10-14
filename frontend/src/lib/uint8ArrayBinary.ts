/**
 * Electron 37 is Chromium 138. pdf.js 5.7 fingerprints every PDF with
 * Uint8Array.prototype.toHex(), which ships in Chromium 140. Without it,
 * Label Center preview and Zebra printing throw "i.toHex is not a function".
 *
 * The same runtime is also missing Uint8Array.fromBase64(), which pdf.js uses
 * for base64 images embedded in a PDF.
 */
const POLYFILL_SOURCE = `
if (typeof Uint8Array.prototype.toHex !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    configurable: true,
    writable: true,
    value: function toHex() {
      var hex = "";
      for (var i = 0; i < this.length; i++) {
        var byte = this[i].toString(16);
        hex += byte.length === 1 ? "0" + byte : byte;
      }
      return hex;
    },
  });
}
if (typeof Uint8Array.fromBase64 !== "function") {
  Object.defineProperty(Uint8Array, "fromBase64", {
    configurable: true,
    writable: true,
    value: function fromBase64(input) {
      var clean = String(input).replace(/\\s/g, "");
      var binary = atob(clean);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    },
  });
}
`

/** Installs the missing methods on this realm. Safe to call more than once. */
export function installUint8ArrayBinaryPolyfill(): void {
  if (typeof Uint8Array === 'undefined') return
  const bytes = Uint8Array.prototype as Uint8Array & { toHex?: () => string }
  const ctor = Uint8Array as Uint8ArrayConstructor & { fromBase64?: (input: string) => Uint8Array }
  if (typeof bytes.toHex === 'function' && typeof ctor.fromBase64 === 'function') return
  new Function(POLYFILL_SOURCE)()
}

/**
 * pdf.js loads its real worker in a separate realm, so the page polyfill does
 * not apply there. Import the polyfill module before the worker module.
 */
export function pdfWorkerSrcWithPolyfill(workerModuleUrl: string): string {
  const polyfillUrl = URL.createObjectURL(new Blob([POLYFILL_SOURCE], { type: 'text/javascript' }))
  const wrapper = `import ${JSON.stringify(polyfillUrl)};\nimport ${JSON.stringify(workerModuleUrl)};\n`
  return URL.createObjectURL(new Blob([wrapper], { type: 'text/javascript' }))
}

installUint8ArrayBinaryPolyfill()
