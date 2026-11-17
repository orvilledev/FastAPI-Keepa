/**
 * Pure logic for reading Seller Central's "Send to Amazon" shipment cards.
 *
 * Each card carries "Shipment ID: FBA…" and, a few lines lower, "Ship to: MCC1 - …".
 * Given the OCR words (with positions) of a screenshot this finds every ID and every
 * Ship to code and pairs each code with the ID of the card it sits in. It has no DOM
 * or OCR-engine dependency, so it can be tested on its own.
 */

export type OcrWord = {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  /** Index of the OCR text line the word was read on. */
  line: number
}

export type FoundWord = {
  /** The word as OCR read it, cleaned to letters and digits. */
  text: string
  box: { x0: number; y0: number; x1: number; y1: number }
}

export type FoundCard = {
  id: FoundWord | null
  shipTo: FoundWord | null
}

const SHIPMENT_ID_SHAPE = /^FBA[A-Z0-9]{9}$/
const SHIP_TO_SHAPE = /^[A-Z]{3}[0-9]{1,2}$/

// Look-alike characters OCR swaps. Used only to coerce a Ship to code into shape.
const TO_LETTER: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
}
const TO_DIGIT: Record<string, string> = {
  O: '0',
  D: '0',
  Q: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  G: '6',
  B: '8',
}

/** Letters and digits only, upper case — IDs compare regardless of spacing or punctuation. */
export function normalizeShipmentId(value: string): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isShipmentIdShape(value: string): boolean {
  return SHIPMENT_ID_SHAPE.test(normalizeShipmentId(value))
}

export function normalizeShipTo(value: string): string {
  return (value || '').trim().toUpperCase()
}

export function isShipToShape(value: string): boolean {
  return SHIP_TO_SHAPE.test(normalizeShipTo(value))
}

/** Loose check used to spot an ID among OCR words, tolerating a slip in the "FBA" prefix. */
function looksLikeShipmentId(value: string): boolean {
  const text = normalizeShipmentId(value)
  if (text.length < 10 || text.length > 14) return false
  const prefix = 'FBA'
  let hits = 0
  for (let i = 0; i < 3; i += 1) if (text[i] === prefix[i]) hits += 1
  if (hits < 2) return false
  // One digit is enough: OCR often turns a digit into a letter (1 -> T), and the
  // card's other text ("FBASMWAPPACC…") never has a digit-free ID-length look-alike
  // that also starts with FBA.
  return /[0-9]/.test(text)
}

/**
 * Coerce an OCR read of a Ship to code into three letters then one or two digits,
 * swapping look-alike characters (MCCI -> MCC1, 1ND9 -> IND9). Null if it cannot fit.
 */
export function coerceShipToCode(value: string): string | null {
  const text = normalizeShipmentId(value)
  if (text.length < 4 || text.length > 5) return null
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (i < 3) out += /[A-Z]/.test(char) ? char : TO_LETTER[char] || ''
    else out += /[0-9]/.test(char) ? char : TO_DIGIT[char] || ''
  }
  return SHIP_TO_SHAPE.test(out) ? out : null
}

/** The first run of letters/digits in a token — "MCC1}" and "MCC1-3300" both give "MCC1". */
function leadingToken(value: string): string {
  const parts = (value || '').split(/[^A-Za-z0-9]+/).filter(Boolean)
  return parts[0] ? parts[0].toUpperCase() : ''
}

function letters(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z]/g, '')
}

function toFound(word: OcrWord, text: string): FoundWord {
  return { text, box: { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 } }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Every Shipment ID and Ship to code in the OCR words, with where each was found. */
export function findIdsAndShipTos(words: OcrWord[]): {
  ids: FoundWord[]
  shipTos: FoundWord[]
  wordHeight: number
} {
  const usable = words.filter((word) => (word.text || '').trim() !== '')
  const wordHeight = median(usable.map((word) => word.y1 - word.y0)) || 20

  const ids: FoundWord[] = []
  const seenIds = new Set<string>()
  const addId = (word: OcrWord) => {
    const spot = `${word.x0}:${word.y0}`
    if (seenIds.has(spot)) return
    seenIds.add(spot)
    ids.push(toFound(word, normalizeShipmentId(word.text)))
  }
  // By shape first — an ID is recognisable wherever it appears.
  for (const word of usable) {
    if (looksLikeShipmentId(word.text)) addId(word)
  }

  const byLine = new Map<number, OcrWord[]>()
  for (const word of usable) {
    const group = byLine.get(word.line)
    if (group) group.push(word)
    else byLine.set(word.line, [word])
  }

  const shipTos: FoundWord[] = []
  for (const group of byLine.values()) {
    group.sort((a, b) => a.x0 - b.x0)
    for (let i = 0; i < group.length; i += 1) {
      const label = letters(group[i].text)
      // ...and by label, which still finds an ID that OCR garbled past recognition.
      if (label === 'shipment' && letters(group[i + 1]?.text) === 'id') {
        const idValue = group[i + 2]
        if (idValue && normalizeShipmentId(idValue.text).length >= 8) addId(idValue)
      }
      let value: OcrWord | undefined
      if (label === 'ship' && letters(group[i + 1]?.text) === 'to') value = group[i + 2]
      else if (label === 'shipto') value = group[i + 1]
      if (!value) continue
      const token = leadingToken(value.text)
      if (token) shipTos.push(toFound(value, token))
    }
  }
  return { ids, shipTos, wordHeight }
}

/**
 * Pair each Ship to code with the Shipment ID of its own card: the nearest ID above it
 * in the same column. One-to-one, so a card whose ID was missed can never borrow the
 * ID of the card above it. Anything left unpaired is returned on its own.
 */
export function pairCards(
  ids: FoundWord[],
  shipTos: FoundWord[],
  wordHeight: number,
): FoundCard[] {
  const maxDx = wordHeight * 10
  const maxDy = wordHeight * 20

  const options: Array<{ dy: number; dx: number; id: number; shipTo: number }> = []
  ids.forEach((id, idIndex) => {
    shipTos.forEach((shipTo, shipToIndex) => {
      const dy = shipTo.box.y0 - id.box.y0
      const dx = Math.abs(shipTo.box.x0 - id.box.x0)
      if (dy > 0 && dy <= maxDy && dx <= maxDx) {
        options.push({ dy, dx, id: idIndex, shipTo: shipToIndex })
      }
    })
  })
  options.sort((a, b) => a.dy + a.dx - (b.dy + b.dx))

  const idUsed = new Set<number>()
  const shipToUsed = new Set<number>()
  const cards: FoundCard[] = []
  for (const option of options) {
    if (idUsed.has(option.id) || shipToUsed.has(option.shipTo)) continue
    idUsed.add(option.id)
    shipToUsed.add(option.shipTo)
    cards.push({ id: ids[option.id], shipTo: shipTos[option.shipTo] })
  }
  ids.forEach((id, index) => {
    if (!idUsed.has(index)) cards.push({ id, shipTo: null })
  })
  shipTos.forEach((shipTo, index) => {
    if (!shipToUsed.has(index)) cards.push({ id: null, shipTo })
  })

  // Reading order: top to bottom in rows, left to right within a row.
  const anchor = (card: FoundCard) => (card.id ?? card.shipTo)!.box
  const rowGap = wordHeight * 6
  const sorted = cards.sort((a, b) => anchor(a).y0 - anchor(b).y0)
  const rows: FoundCard[][] = []
  for (const card of sorted) {
    const row = rows.find((candidate) => Math.abs(anchor(candidate[0]).y0 - anchor(card).y0) <= rowGap)
    if (row) row.push(card)
    else rows.push([card])
  }
  return rows.flatMap((row) => row.sort((a, b) => anchor(a).x0 - anchor(b).x0))
}

export type VoteResult = {
  value: string
  /** True only when the value fits the expected shape AND every read that fits agrees on it. */
  confident: boolean
}

/**
 * Pick the read most attempts agree on, preferring reads that fit the expected shape. On
 * a tie the earliest read wins, so callers list the most trusted read first.
 *
 * `confident` is deliberately strict: two look-alike misreads can outvote one correct
 * read, so a value is only trusted when all of the valid reads say the same thing.
 * Anything less is flagged for the user to check against the screenshot.
 */
export function pickByVote(reads: string[], isValid: (value: string) => boolean): VoteResult {
  const cleaned = reads.filter((read) => read !== '')
  const valid = cleaned.filter(isValid)
  const pool = valid.length > 0 ? valid : cleaned
  if (pool.length === 0) return { value: '', confident: false }

  const counts = new Map<string, number>()
  for (const read of pool) counts.set(read, (counts.get(read) || 0) + 1)
  let best = pool[0]
  for (const read of pool) {
    if ((counts.get(read) || 0) > (counts.get(best) || 0)) best = read
  }
  const votes = counts.get(best) || 0
  return {
    value: best,
    confident: valid.length >= 2 && votes === valid.length,
  }
}
