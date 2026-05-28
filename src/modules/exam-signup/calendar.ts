import type { ExamPreferences, ExamRegistrationState, ExamRowInfo } from './state'
import { parseExamDateText, type ParsedExamDate } from './date'

export type ExamCalendarSource = 'saved' | 'registered'

export interface ExamCalendarEntry {
  id: string
  subjectCode: string
  rawDate: string
  parsed: ParsedExamDate
  type: string
  courseCode: string
  source: ExamCalendarSource
  registrationState?: ExamRegistrationState
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function todayKey(now: Date): string {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  return `${year}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`
}

function compareEntries(a: ExamCalendarEntry, b: ExamCalendarEntry): number {
  return (
    a.parsed.day.localeCompare(b.parsed.day) ||
    a.parsed.time.localeCompare(b.parsed.time) ||
    a.subjectCode.localeCompare(b.subjectCode)
  )
}

function entryKey(entry: ExamCalendarEntry): string {
  return `${entry.subjectCode}|${entry.parsed.day}|${entry.parsed.time}`
}

function getInitialMonth(entries: ExamCalendarEntry[], now: Date): { year: number; month: number } {
  const today = todayKey(now)
  const sorted = [...entries].sort(compareEntries)
  const upcoming = sorted.find((entry) => entry.parsed.day >= today) ?? sorted[sorted.length - 1]

  return {
    year: upcoming.parsed.year,
    month: upcoming.parsed.month,
  }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function getMonthStartOffset(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7
}

function groupByDay(entries: ExamCalendarEntry[]): Map<string, ExamCalendarEntry[]> {
  const map = new Map<string, ExamCalendarEntry[]>()
  for (const entry of entries) {
    const dayEntries = map.get(entry.parsed.day) ?? []
    dayEntries.push(entry)
    map.set(entry.parsed.day, dayEntries)
  }

  for (const dayEntries of map.values()) {
    dayEntries.sort(compareEntries)
  }

  return map
}

export function buildSavedExamCalendarEntries(prefs: ExamPreferences): ExamCalendarEntry[] {
  const entries: ExamCalendarEntry[] = []

  for (const [subjectCode, pref] of Object.entries(prefs)) {
    const parsed = parseExamDateText(pref.date)
    if (!parsed) continue

    entries.push({
      id: `saved:${subjectCode}:${parsed.day}:${parsed.time}`,
      subjectCode,
      rawDate: pref.date,
      parsed,
      type: pref.type,
      courseCode: pref.courseCode,
      source: 'saved',
    })
  }

  return entries.sort(compareEntries)
}

export function buildRegisteredExamCalendarEntries(
  rows: Array<{ info: ExamRowInfo; subjectCode: string | null }>,
): ExamCalendarEntry[] {
  const entries: ExamCalendarEntry[] = []

  for (const { info, subjectCode } of rows) {
    if (info.registrationState !== 'registered') continue
    const parsed = parseExamDateText(info.date)
    if (!parsed) continue

    const resolvedSubjectCode = subjectCode ?? 'Unknown subject'
    entries.push({
      id: `registered:${resolvedSubjectCode}:${parsed.day}:${parsed.time}`,
      subjectCode: resolvedSubjectCode,
      rawDate: info.date,
      parsed,
      type: info.type,
      courseCode: info.courseCode,
      source: 'registered',
      registrationState: info.registrationState,
    })
  }

  return entries.sort(compareEntries)
}

export function mergeExamCalendarEntries(
  savedEntries: ExamCalendarEntry[],
  registeredEntries: ExamCalendarEntry[],
): ExamCalendarEntry[] {
  const merged = new Map<string, ExamCalendarEntry>()
  for (const entry of savedEntries) {
    merged.set(entryKey(entry), entry)
  }

  for (const entry of registeredEntries) {
    merged.set(entryKey(entry), entry)
  }

  return Array.from(merged.values()).sort(compareEntries)
}

export function renderExamCalendar(
  entries: ExamCalendarEntry[],
  now: Date = new Date(),
): HTMLElement | null {
  if (entries.length === 0) return null

  const today = todayKey(now)
  const entriesByDay = groupByDay(entries)
  let { year, month } = getInitialMonth(entries, now)
  let selectedDay =
    entries.find((entry) => entry.parsed.day >= today)?.parsed.day ?? entries[0]?.parsed.day

  const root = document.createElement('div')
  root.style.cssText =
    'margin-top: 8px; padding: 7px; background: #0f2040; border-radius: 4px; color: #d9e7ff;'

  const label = document.createElement('div')
  label.style.cssText =
    'font-size: 10px; color: #8baae0; margin-bottom: 5px; display: flex; justify-content: space-between; gap: 6px;'
  label.textContent = 'Registered exams'
  root.appendChild(label)

  const header = document.createElement('div')
  header.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 6px;'

  const title = document.createElement('div')
  title.style.cssText = 'font-weight: 700; color: #5c9eff; font-size: 11px; flex: 1;'

  const prevBtn = document.createElement('button')
  const nextBtn = document.createElement('button')
  for (const btn of [prevBtn, nextBtn]) {
    btn.type = 'button'
    btn.style.cssText =
      'width: 24px; height: 22px; border: 1px solid #2c4875; background: #162d55; color: #d9e7ff; border-radius: 3px; cursor: pointer; font-size: 12px; line-height: 1;'
  }
  prevBtn.textContent = '<'
  prevBtn.title = 'Previous month'
  nextBtn.textContent = '>'
  nextBtn.title = 'Next month'

  header.appendChild(prevBtn)
  header.appendChild(title)
  header.appendChild(nextBtn)
  root.appendChild(header)

  const grid = document.createElement('div')
  grid.style.cssText = 'display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px;'
  root.appendChild(grid)

  const details = document.createElement('div')
  details.style.cssText =
    'margin-top: 7px; border-top: 1px solid #1a3560; padding-top: 6px; max-height: 88px; overflow-y: auto;'
  root.appendChild(details)

  function renderDetails(): void {
    while (details.firstChild) details.removeChild(details.firstChild)

    const dayEntries = selectedDay ? (entriesByDay.get(selectedDay) ?? []) : []
    if (dayEntries.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'font-size: 10px; color: #8baae0;'
      empty.textContent = 'No exam selected.'
      details.appendChild(empty)
      return
    }

    for (const entry of dayEntries) {
      const row = document.createElement('div')
      row.style.cssText =
        'display: grid; grid-template-columns: auto 1fr auto; gap: 5px; align-items: baseline; padding: 2px 0; font-size: 10px;'

      const time = document.createElement('span')
      time.style.cssText = 'color: #ffffff; font-weight: 700;'
      time.textContent = entry.parsed.time
      row.appendChild(time)

      const label = document.createElement('span')
      label.style.cssText = 'color: #b7cdf8; overflow-wrap: anywhere;'
      label.textContent = `${entry.subjectCode}${entry.courseCode ? ` (${entry.courseCode})` : ''}`
      row.appendChild(label)

      const badge = document.createElement('span')
      badge.style.cssText = `color: ${entry.source === 'registered' ? '#7de38b' : '#80b8ff'}; font-weight: 700;`
      badge.textContent = entry.source === 'registered' ? 'Registered' : 'Saved'
      row.appendChild(badge)

      details.appendChild(row)
    }
  }

  function renderMonth(): void {
    title.textContent = `${MONTH_LABELS[month - 1]} ${year}`
    while (grid.firstChild) grid.removeChild(grid.firstChild)

    for (const label of WEEKDAY_LABELS) {
      const cell = document.createElement('div')
      cell.style.cssText = 'font-size: 9px; color: #8baae0; text-align: center; font-weight: 700;'
      cell.textContent = label
      grid.appendChild(cell)
    }

    for (let i = 0; i < getMonthStartOffset(year, month); i++) {
      grid.appendChild(document.createElement('div'))
    }

    for (let day = 1; day <= getDaysInMonth(year, month); day++) {
      const key = `${year}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`
      const dayEntries = entriesByDay.get(key) ?? []
      const hasRegistered = dayEntries.some((entry) => entry.source === 'registered')
      const hasSaved = dayEntries.some((entry) => entry.source === 'saved')
      const isSelected = selectedDay === key
      const isToday = today === key

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.style.cssText = [
        'height: 25px',
        'border-radius: 3px',
        'border: 1px solid transparent',
        'font-size: 10px',
        'font-weight: 700',
        'cursor: pointer',
        'letter-spacing: 0',
        dayEntries.length > 0 ? 'color: #ffffff' : 'color: #9db3d6',
        hasRegistered
          ? 'background: #1f5f45'
          : hasSaved
            ? 'background: #173f72'
            : 'background: #172846',
        isSelected ? 'border-color: #ffffff' : isToday ? 'border-color: #ffcf66' : '',
      ]
        .filter(Boolean)
        .join(';')
      btn.textContent = `${day}`
      btn.title = dayEntries
        .map((entry) => `${entry.parsed.time} ${entry.subjectCode} (${entry.source})`)
        .join('\n')
      btn.addEventListener('click', () => {
        selectedDay = key
        renderMonth()
        renderDetails()
      })
      grid.appendChild(btn)
    }
  }

  prevBtn.addEventListener('click', () => {
    month--
    if (month < 1) {
      month = 12
      year--
    }
    renderMonth()
  })

  nextBtn.addEventListener('click', () => {
    month++
    if (month > 12) {
      month = 1
      year++
    }
    renderMonth()
  })

  renderMonth()
  renderDetails()
  return root
}
