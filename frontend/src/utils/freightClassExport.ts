import type { FreightCalculationResult } from '../services/api'

export function formatSummaryForClipboard(result: FreightCalculationResult): string {
  const header = [
    'Shipment ID',
    'Total Pallets',
    'Total Weight (lbs)',
    'Total Volume (ft³)',
    'Density (lb/ft³)',
    'Freight Class',
    '75" Rule',
  ].join('\t')

  const rows = result.shipments.map((s) => {
    const pallets = s.line_items.reduce((sum, li) => sum + li.pallets, 0)
    return [
      s.shipment_id,
      String(pallets),
      s.total_weight_lbs.toFixed(2),
      s.total_cubic_feet.toFixed(4),
      s.density_pcf.toFixed(4),
      String(s.freight_class),
      s.height_rule_applied ? 'Yes' : 'No',
    ].join('\t')
  })

  const breakdown = Object.entries(result.summary.class_breakdown)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([cls, count]) => `Class ${cls}: ${count} shipment${count === 1 ? '' : 's'}`)
    .join('\n')

  return [
    header,
    ...rows,
    '',
    `Total shipments: ${result.summary.shipment_count}`,
    breakdown,
  ].join('\n')
}

export async function copySummaryToClipboard(result: FreightCalculationResult): Promise<void> {
  const text = formatSummaryForClipboard(result)
  await navigator.clipboard.writeText(text)
}

export function classBadgeStyle(freightClass: number): string {
  if (freightClass <= 70) {
    return 'border-emerald-200/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-200'
  }
  if (freightClass <= 100) {
    return 'border-[#81B81D]/30 bg-[#81B81D]/10 text-[#3d5c0f] dark:border-[#81B81D]/40 dark:bg-[#81B81D]/15 dark:text-[#c5e887]'
  }
  if (freightClass <= 175) {
    return 'border-amber-200/80 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200'
  }
  if (freightClass <= 300) {
    return 'border-orange-200/80 bg-orange-50 text-orange-900 dark:border-orange-800/50 dark:bg-orange-950/40 dark:text-orange-200'
  }
  return 'border-red-200/80 bg-red-50 text-red-900 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-200'
}
