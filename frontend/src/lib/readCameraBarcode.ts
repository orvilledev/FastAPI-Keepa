import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  HTMLCanvasElementLuminanceSource,
  MultiFormatReader,
  NotFoundException,
} from '@zxing/library'

const PRODUCT_FORMATS = [
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
]

const reader = new MultiFormatReader()
reader.setHints(
  new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, PRODUCT_FORMATS],
    [DecodeHintType.TRY_HARDER, true],
  ]),
)

type BarcodeHit = { rawValue?: string }

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<BarcodeHit[]>
}

let nativeDetector: BarcodeDetectorLike | null | undefined

function nativeBarcodeDetector(): BarcodeDetectorLike | null {
  if (nativeDetector !== undefined) return nativeDetector
  const Detector = (
    window as Window & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike
    }
  ).BarcodeDetector
  if (typeof Detector !== 'function') {
    nativeDetector = null
    return null
  }
  try {
    nativeDetector = new Detector({
      formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39', 'itf', 'qr_code'],
    })
  } catch {
    nativeDetector = null
  }
  return nativeDetector
}

function readWithZxing(canvas: HTMLCanvasElement): string | null {
  try {
    const source = new HTMLCanvasElementLuminanceSource(canvas)
    const bitmap = new BinaryBitmap(new HybridBinarizer(source))
    const text = reader.decode(bitmap).getText().trim()
    return text || null
  } catch (error) {
    if (error instanceof NotFoundException) return null
    return null
  } finally {
    reader.reset()
  }
}

/** Read one barcode from the current video frame, or null when the frame has none. */
export async function readBarcodeFromVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null

  const detector = nativeBarcodeDetector()
  if (detector) {
    try {
      const hits = await detector.detect(video)
      const text = hits.map((hit) => (hit.rawValue || '').trim()).find(Boolean)
      if (text) return text
    } catch {
      // A single bad frame should not stop the camera.
    }
  }

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return readWithZxing(canvas)
}
