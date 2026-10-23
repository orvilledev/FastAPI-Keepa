/**
 * Hands QBOID M2 scans from the Dimensioner page to the Freight Class Calculator.
 *
 * The scans travel in React Router navigation state, so nothing is stored and a
 * page refresh simply drops them. Values are inches and pounds, as strings, ready
 * to drop into the calculator's pallet fields (which stay editable).
 */
import type { DimensionerScan } from '../services/api'

export type DimensionerHandoffRow = {
  length: string
  width: string
  height: string
  /** Empty when the device did not capture a weight. */
  weight: string
}

export type DimensionerHandoff = {
  /** Lets the receiving page ignore a handoff it has already applied. */
  nonce: string
  rows: DimensionerHandoffRow[]
}

export const DIMENSIONER_HANDOFF_STATE_KEY = 'dimensionerHandoff'

/** True when the scan has all three dimensions, which the calculator needs. */
export function canSendToFreightClass(scan: DimensionerScan): boolean {
  return [scan.length_in, scan.width_in, scan.height_in].every(
    (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
  )
}

function inchesText(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

/** One calculator row per scan that has all three dimensions, in the order given. */
export function toHandoffRows(scans: DimensionerScan[]): DimensionerHandoffRow[] {
  return scans.filter(canSendToFreightClass).map((scan) => ({
    length: inchesText(scan.length_in),
    width: inchesText(scan.width_in),
    height: inchesText(scan.height_in),
    weight: inchesText(scan.weight_lb),
  }))
}

/** The router-state payload for `navigate('/freight-class-calculator', { state })`. */
export function buildHandoffState(rows: DimensionerHandoffRow[]): {
  [DIMENSIONER_HANDOFF_STATE_KEY]: DimensionerHandoff
} {
  return { [DIMENSIONER_HANDOFF_STATE_KEY]: { nonce: crypto.randomUUID(), rows } }
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/** Reads a handoff out of router state, or null for anything that is not one. */
export function readDimensionerHandoff(state: unknown): DimensionerHandoff | null {
  if (!state || typeof state !== 'object') return null
  const raw = (state as Record<string, unknown>)[DIMENSIONER_HANDOFF_STATE_KEY]
  if (!raw || typeof raw !== 'object') return null
  const { nonce, rows } = raw as { nonce?: unknown; rows?: unknown }
  if (!isText(nonce) || !nonce || !Array.isArray(rows) || rows.length === 0) return null

  const clean: DimensionerHandoffRow[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null
    const { length, width, height, weight } = row as Record<string, unknown>
    if (!isText(length) || !isText(width) || !isText(height) || !isText(weight)) return null
    clean.push({ length, width, height, weight })
  }
  return { nonce, rows: clean }
}
