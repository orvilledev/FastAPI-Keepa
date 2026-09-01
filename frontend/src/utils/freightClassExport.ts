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
  if (freightClass <= 70) return 'bg-emerald-100 text-emerald-900 border-emerald-300'
  if (freightClass <= 100) return 'bg-lime-100 text-lime-900 border-lime-300'
  if (freightClass <= 175) return 'bg-amber-100 text-amber-900 border-amber-300'
  if (freightClass <= 300) return 'bg-orange-100 text-orange-900 border-orange-300'
  return 'bg-red-100 text-red-900 border-red-300'
}
