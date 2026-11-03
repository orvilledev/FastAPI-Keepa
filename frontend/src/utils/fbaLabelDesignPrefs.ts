import { authApi } from '../services/api'
import { canUseUpcDnkPrintId } from '../lib/labelStationPrintIdAccess'
import { getSelectedLabelIdMode, type LabelIdMode } from './warehouseLabel'

/**
 * FBA Order Checker — "Print FNSKU labels" design prompt.
 *
 * The label design itself (size, Print ID, custom text, printer, dpi) is stored in
 * the same browser keys Label Station uses, so both pages always agree. This module
 * only adds one extra flag: whether the user ticked "use this design for the next
 * prints", which makes Print FNSKU labels skip the design popup.
 */
export const FNSKU_LABEL_DESIGN_REMEMBERED_KEY = 'fba_order_checker_label_design_remembered'

export function isFnskuLabelDesignRemembered(): boolean {
  try {
    return localStorage.getItem(FNSKU_LABEL_DESIGN_REMEMBERED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveFnskuLabelDesignRemembered(remembered: boolean): void {
  try {
    if (remembered) localStorage.setItem(FNSKU_LABEL_DESIGN_REMEMBERED_KEY, '1')
    else localStorage.removeItem(FNSKU_LABEL_DESIGN_REMEMBERED_KEY)
  } catch {
    // ignore
  }
}

/** Live server check for UPC (DNK). Fails closed so a stale allow is never trusted. */
export async function fetchCanUseUpcDnkPrintId(): Promise<boolean> {
  try {
    const result = await authApi.getUpcDnkPrintIdAccess()
    return canUseUpcDnkPrintId(result.allowed)
  } catch {
    return false
  }
}

/**
 * Print ID to print with: the saved mode, except UPC (DNK) falls back to Short SKU
 * for accounts that are not allowed to use it (same rule as Label Station).
 */
export async function resolveLabelIdMode(): Promise<LabelIdMode> {
  const saved = getSelectedLabelIdMode()
  if (saved !== 'upc') return saved
  return (await fetchCanUseUpcDnkPrintId()) ? 'upc' : 'auto'
}
