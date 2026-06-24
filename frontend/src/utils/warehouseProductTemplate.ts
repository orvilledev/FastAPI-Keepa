import XLSX from 'xlsx-js-style'

/** Column headers expected by warehouse product import (case-insensitive). */
export const WAREHOUSE_PRODUCTS_TEMPLATE_HEADERS = [
  'UPC',
  'SKU',
  'fnsku',
  'STYLE NAME',
  'Condition',
] as const

export const WAREHOUSE_PRODUCTS_SHEET_NAME = 'PRODUCTS'
export const WAREHOUSE_PRODUCTS_TEMPLATE_FILENAME = 'warehouse-products-template.xlsx'

const EXAMPLE_ROW = ['196010065624', 'SW001', 'X00532WIT7', 'Smartwool Socks', 'New']

/** Build an empty PRODUCTS-sheet workbook matching Scan & Print import format. */
export function buildWarehouseProductsTemplateBlob(): Blob {
  const aoa = [WAREHOUSE_PRODUCTS_TEMPLATE_HEADERS, EXAMPLE_ROW]
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false })
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 36 }, { wch: 12 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, WAREHOUSE_PRODUCTS_SHEET_NAME)
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
