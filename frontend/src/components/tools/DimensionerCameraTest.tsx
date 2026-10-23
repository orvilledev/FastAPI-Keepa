import { useCallback, useEffect, useRef, useState } from 'react'
import { dimensionerApi } from '../../services/api'
import { readBarcodeFromVideo } from '../../lib/readCameraBarcode'
import { getApiErrorDetail } from '../../utils/apiErrorMessage'

const SCAN_INTERVAL_MS = 350

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

type MeasureFields = {
  lengthIn: string
  widthIn: string
  heightIn: string
  weightLb: string
}

const EMPTY_MEASURES: MeasureFields = {
  lengthIn: '',
  widthIn: '',
  heightIn: '',
  weightLb: '',
}

function optionalMeasure(raw: string, label: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero, or left blank.`)
  }
  return value
}

export default function DimensionerCameraTest({ onSaved }: { onSaved: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lookingRef = useRef(true)
  const cameraGen = useRef(0)

  const [open, setOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [barcode, setBarcode] = useState('')
  const [locked, setLocked] = useState(false)
  const [measures, setMeasures] = useState<MeasureFields>(EMPTY_MEASURES)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const stopCamera = useCallback(() => {
    cameraGen.current += 1
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  const startCamera = useCallback(async () => {
    const generation = ++cameraGen.current
    setCameraError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot open a camera. Type the barcode instead.')
      return
    }
    stopTracks(streamRef.current)
    streamRef.current = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      })
      if (generation !== cameraGen.current) {
        stopTracks(stream)
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      if (generation !== cameraGen.current) {
        stopTracks(stream)
        return
      }
      setCameraOn(true)
    } catch {
      if (generation !== cameraGen.current) return
      setCameraError('The camera could not be opened. Allow it in the browser, or type the barcode.')
      setCameraOn(false)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      stopCamera()
      return
    }
    void startCamera()
    return () => stopCamera()
  }, [open, startCamera, stopCamera])

  useEffect(() => {
    if (!cameraOn || locked) return
    let timer = 0
    let cancelled = false

    const tick = async () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!cancelled && video && canvas && lookingRef.current) {
        try {
          const found = await readBarcodeFromVideo(video, canvas)
          if (found && lookingRef.current) {
            lookingRef.current = false
            setBarcode(found)
            setLocked(true)
            setFormError(null)
          }
        } catch {
          // Keep looking on the next tick.
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS)
    }

    timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [cameraOn, locked])

  const scanAgain = () => {
    lookingRef.current = true
    setLocked(false)
    setBarcode('')
    setFormError(null)
  }

  const close = () => {
    setOpen(false)
    setFormError(null)
    setCameraError(null)
  }

  const save = async () => {
    const code = barcode.trim()
    if (!code) {
      setFormError('Scan or type a barcode first.')
      return
    }
    let lengthIn: number | null
    let widthIn: number | null
    let heightIn: number | null
    let weightLb: number | null
    try {
      lengthIn = optionalMeasure(measures.lengthIn, 'Length')
      widthIn = optionalMeasure(measures.widthIn, 'Width')
      heightIn = optionalMeasure(measures.heightIn, 'Height')
      weightLb = optionalMeasure(measures.weightLb, 'Weight')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Check the sizes and try again.')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      await dimensionerApi.createTestScan({
        barcode: code,
        length_in: lengthIn,
        width_in: widthIn,
        height_in: heightIn,
        weight_lb: weightLb,
      })
      setMeasures(EMPTY_MEASURES)
      lookingRef.current = true
      setLocked(false)
      setBarcode('')
      onSaved()
    } catch (error) {
      setFormError(getApiErrorDetail(error) || 'Could not save the test scan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-surface dark:text-gray-100 dark:hover:bg-gray-800"
        >
          Test with camera
        </button>
      ) : (
        <div className="rounded-2xl border border-gray-300 bg-white p-5 shadow-md dark:border-gray-600 dark:bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Test with camera</h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
                Testing only. Point the camera at a product barcode. A laptop camera cannot measure
                the box, so type the inches and pounds if you want them on the row. Saving adds a
                scan to the list, marked camera-test. This does not use the M2.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
            <div>
              <div className="relative overflow-hidden rounded-xl bg-gray-900">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  className="aspect-[4/3] w-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />
                {!cameraOn && (
                  <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-gray-300">
                    Camera is off
                  </div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {cameraOn ? (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Stop camera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Open camera
                  </button>
                )}
                <button
                  type="button"
                  onClick={scanAgain}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Scan again
                </button>
              </div>
              {cameraError && (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{cameraError}</p>
              )}
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                {locked ? `Barcode read: ${barcode}` : cameraOn ? 'Looking for a barcode…' : 'Type a barcode if the camera is unavailable.'}
              </p>
            </div>

            <div className="space-y-3">
              <label className="block text-sm">
                <span className="font-medium text-gray-800 dark:text-gray-200">Barcode</span>
                <input
                  value={barcode}
                  onChange={(event) => {
                    lookingRef.current = false
                    setLocked(true)
                    setBarcode(event.target.value)
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-[#81B81D] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81B81D]/25 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-100"
                />
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ['lengthIn', 'Length (in)'],
                    ['widthIn', 'Width (in)'],
                    ['heightIn', 'Height (in)'],
                    ['weightLb', 'Weight (lb)'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block text-sm">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{label}</span>
                    <input
                      inputMode="decimal"
                      value={measures[key]}
                      onChange={(event) =>
                        setMeasures((current) => ({ ...current, [key]: event.target.value }))
                      }
                      placeholder="Optional"
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-[#81B81D] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81B81D]/25 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-100"
                    />
                  </label>
                ))}
              </div>
              {formError && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                  {formError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-xl bg-[#81B81D] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#6fa019] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save test scan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
