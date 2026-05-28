export interface ParsedExamDate {
  raw: string
  day: string
  time: string
  year: number
  month: number
  dayOfMonth: number
}

const HUNGARIAN_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  marcius: 3,
  aprilis: 4,
  majus: 5,
  junius: 6,
  julius: 7,
  augusztus: 8,
  szeptember: 9,
  oktober: 10,
  november: 11,
  december: 12,
}

const HUNGARIAN_DATE_RE = /(\d{4})\.\s*([A-Za-z\u00c0-\u017f]+)\s+(\d{1,2})\.\s*(\d{1,2}):(\d{2})/i
const NUMERIC_DATE_RE = /(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?\s+(\d{1,2}):(\d{2})/

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

function normalizeMonthName(value: string): string {
  return value
    .toLocaleLowerCase('hu-HU')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function buildParsedDate(
  raw: string,
  year: number,
  month: number,
  dayOfMonth: number,
  hour: number,
  minute: number,
): ParsedExamDate | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(dayOfMonth) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    month < 1 ||
    month > 12 ||
    dayOfMonth < 1 ||
    dayOfMonth > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  return {
    raw: raw.replace(/\s+/g, ' ').trim(),
    day: `${year}-${pad2(month)}-${pad2(dayOfMonth)}`,
    time: `${pad2(hour)}:${pad2(minute)}`,
    year,
    month,
    dayOfMonth,
  }
}

export function extractExamDateText(text: string): string | null {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  const match = normalizedText.match(HUNGARIAN_DATE_RE) ?? normalizedText.match(NUMERIC_DATE_RE)
  return match?.[0].replace(/\s+/g, ' ').trim() ?? null
}

export function parseExamDateText(text: string): ParsedExamDate | null {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  const hungarianMatch = normalizedText.match(HUNGARIAN_DATE_RE)
  if (hungarianMatch) {
    const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = hungarianMatch
    const month = HUNGARIAN_MONTHS[normalizeMonthName(rawMonth)]
    if (!month) return null

    return buildParsedDate(
      hungarianMatch[0],
      Number(rawYear),
      month,
      Number(rawDay),
      Number(rawHour),
      Number(rawMinute),
    )
  }

  const numericMatch = normalizedText.match(NUMERIC_DATE_RE)
  if (!numericMatch) return null

  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = numericMatch
  return buildParsedDate(
    numericMatch[0],
    Number(rawYear),
    Number(rawMonth),
    Number(rawDay),
    Number(rawHour),
    Number(rawMinute),
  )
}
