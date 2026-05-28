import {
  getApi,
  getCachedSubjectCode,
  setCachedSubjectCode,
  getTableObserver,
  setTableObserver,
  getDebounceTimer,
  setDebounceTimer,
  getIsDisposed,
  getIsEnrollmentInProgress,
  HIGHLIGHT_STYLE,
} from './state'
import type { ExamRowInfo } from './state'
import { extractExamDateText } from './date'
import { extractSubjectCodeFromText } from '../../utils/subject-code'

function getSubjectCodeFromElements(elements: Array<Element | null | undefined>): string | null {
  for (const element of elements) {
    const text = element?.textContent ?? ''
    const code = extractSubjectCodeFromText(text)
    if (code) return code
  }

  return null
}

function getStableOwnText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getStandaloneSubjectCode(element: Element): string | null {
  if (!['P', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) {
    return null
  }

  const ownText = getStableOwnText(element)
  if (!ownText || ownText.length > 40) return null

  const code = extractSubjectCodeFromText(ownText)
  return code && code === ownText.replace(/\s+/g, '').toUpperCase() ? code : null
}

function getCellText(cell: Element | null | undefined): string {
  if (!cell) return ''

  const clone = cell.cloneNode(true) as Element
  clone.querySelectorAll('.npu-exam-save-slot, .npu-exam-save-btn').forEach((node) => node.remove())

  return clone.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function getEnrollmentButton(row: HTMLTableRowElement): HTMLButtonElement | null {
  const buttons = Array.from(row.querySelectorAll('button')) as HTMLButtonElement[]

  const submitButton = buttons.find((button) => {
    const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    return text.includes('felv')
  })

  return submitButton ?? null
}

function normalizeStatusText(text: string): string {
  return text
    .toLocaleLowerCase('hu-HU')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function getButtonTexts(root: Element | null | undefined): string[] {
  if (!root) return []

  return Array.from(root.querySelectorAll('button'))
    .map((button) => normalizeStatusText(button.textContent ?? '').trim())
    .filter(Boolean)
}

function getRegistrationState(
  cells: Element[],
  cellTexts: string[],
  date: string,
  felvetelBtn: HTMLButtonElement | null,
): ExamRowInfo['registrationState'] {
  const dateCellStatusText = normalizeStatusText((cellTexts[0] ?? '').replace(date, ' '))
  const actionButtonTexts = getButtonTexts(cells[cells.length - 1])

  if (
    dateCellStatusText.includes('felveve') ||
    actionButtonTexts.some((text) => text === 'leadas')
  ) {
    return 'registered'
  }
  if (dateCellStatusText.includes('betelt')) return 'full'
  if (dateCellStatusText.includes('varolistas')) return 'waitlistOnly'
  if (felvetelBtn) return 'available'
  return 'unknown'
}

export type TableSubjectCodeMap = Map<Element, string>

export function buildTableSubjectCodeMap(): TableSubjectCodeMap {
  const map = new Map<Element, string>()
  const root = document.querySelector('main') ?? document.body
  if (!root) return map

  let currentCode: string | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let currentNode = walker.currentNode as Element | null

  while (currentNode) {
    const code = getStandaloneSubjectCode(currentNode)
    if (code) {
      currentCode = code
    } else if (currentNode.tagName === 'TABLE' && currentCode) {
      map.set(currentNode, currentCode)
    }

    currentNode = walker.nextNode() as Element | null
  }

  return map
}

function getSubjectCodeForTable(
  table: Element | null,
  tableSubjectCodes: TableSubjectCodeMap = buildTableSubjectCodeMap(),
): string | null {
  if (!table) return null

  return tableSubjectCodes.get(table) ?? null
}

export function getRowSubjectCode(
  row: HTMLTableRowElement,
  tableSubjectCodes: TableSubjectCodeMap = buildTableSubjectCodeMap(),
): string | null {
  return getSubjectCodeForTable(row.closest('table'), tableSubjectCodes)
}

function getPageSubjectCodes(): string[] {
  const uniqueCodes = new Set<string>()
  const tableSubjectCodes = buildTableSubjectCodeMap()

  for (const code of tableSubjectCodes.values()) {
    uniqueCodes.add(code)
  }

  return Array.from(uniqueCodes)
}

export function getSubjectCode(): string | null {
  const api = getApi()
  const cached = getCachedSubjectCode()
  if (cached !== undefined) {
    api?.logger.info(`[exam-dom-debug] getSubjectCode: returning cached="${cached}"`)
    return cached
  }

  // First try: URL query params (subjectName often contains the code)
  try {
    const params = new URLSearchParams(window.location.search)
    const subjectName = params.get('subjectName') ?? ''
    const code = extractSubjectCodeFromText(subjectName)
    if (code) {
      api?.logger.info(`[exam-dom-debug] getSubjectCode: found via URL param, code="${code}"`)
      setCachedSubjectCode(code)
      return code
    }
  } catch {
    // ignore URL parse errors
  }

  // Second try: heading area and nearby metadata only.
  const h1 = document.querySelector('h1')
  if (h1) {
    const code = getSubjectCodeFromElements([
      h1,
      h1.previousElementSibling,
      h1.nextElementSibling,
      h1.closest('section'),
      h1.closest('article'),
      h1.closest('mat-card'),
    ])

    if (code) {
      api?.logger.info(`[exam-dom-debug] getSubjectCode: found near heading, code="${code}"`)
      setCachedSubjectCode(code)
      return code
    }
  }

  const pageSubjectCodes = getPageSubjectCodes()
  if (pageSubjectCodes.length === 1) {
    api?.logger.info(
      `[exam-dom-debug] getSubjectCode: found single page subject code="${pageSubjectCodes[0]}"`,
    )
    setCachedSubjectCode(pageSubjectCodes[0])
    return pageSubjectCodes[0]
  }

  if (pageSubjectCodes.length > 1) {
    api?.logger.info(
      '[exam-dom-debug] getSubjectCode: multiple subject tables detected, no single page subject code',
    )
  }

  api?.logger.warn('[exam-dom-debug] getSubjectCode: no subject code found on page')
  setCachedSubjectCode(null)
  return null
}

export function getSubjectName(): string | null {
  const h1 = document.querySelector('h1')
  return h1?.textContent?.trim() ?? null
}

export function getExamRows(): HTMLTableRowElement[] {
  const rows = Array.from(document.querySelectorAll('table tr'))
  return rows.filter((row) => {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) return false

    const actionButton = row.querySelector('button')
    return !!actionButton
  }) as HTMLTableRowElement[]
}

export function parseExamRow(row: HTMLTableRowElement): ExamRowInfo {
  const api = getApi()
  const cells = Array.from(row.querySelectorAll('td'))
  const felvetelBtn = getEnrollmentButton(row)
  if (cells.length < 4) {
    api?.logger.warn(`[exam-dom-debug] parseExamRow: only ${cells.length} cells, expected 4+`)
  }
  const cellTexts = cells.map((c) => getCellText(c))

  // Newer Neptun layouts collapse the table to 4 columns on narrower viewports:
  // date, type, capacity, action. Older layouts expose instructor and course code too.
  const isCompactLayout = cells.length === 4
  const date = extractExamDateText(cellTexts[0] ?? '') ?? cellTexts[0] ?? ''
  const type = cellTexts[1] ?? ''
  const capacity = cellTexts[2] ?? ''
  const instructor = isCompactLayout ? '' : (cellTexts[3] ?? '')
  const courseCode = isCompactLayout ? '' : (cellTexts[4] ?? '')
  const registrationState = getRegistrationState(cells, cellTexts, date, felvetelBtn)

  if (!felvetelBtn && registrationState === 'unknown') {
    api?.logger.warn('[exam-dom-debug] parseExamRow: action button not found on row')
  }

  return {
    row,
    date,
    type,
    capacity,
    instructor,
    courseCode,
    registrationState,
    felvetelBtn,
  }
}

export interface SaveButtonInjectionStats {
  addedCount: number
  rowCount: number
}

export function addSaveButtonsToRows(
  subjectCode: string | null,
  onSave: (subjectCode: string, date: string, type: string, courseCode: string) => void,
): SaveButtonInjectionStats {
  const api = getApi()

  // Remove any previously added save buttons
  document.querySelectorAll('.npu-exam-save-btn').forEach((b) => b.remove())
  document.querySelectorAll('.npu-exam-save-slot').forEach((slot) => slot.remove())

  const tableSubjectCodes = buildTableSubjectCodeMap()
  const rows = getExamRows()
  api?.logger.info(
    `[exam-dom-debug] addSaveButtonsToRows: processing ${rows.length} exam rows for ${subjectCode}`,
  )
  let addedCount = 0
  for (const row of rows) {
    const info = parseExamRow(row)
    const resolvedSubjectCode =
      getSubjectCodeForTable(row.closest('table'), tableSubjectCodes) ?? subjectCode
    if (!resolvedSubjectCode) {
      api?.logger.warn(
        `[exam-dom-debug] addSaveButtonsToRows: no subjectCode resolved for row date="${info.date}"`,
      )
      continue
    }

    const firstCell = row.querySelector('td')
    if (!firstCell) {
      api?.logger.warn(
        `[exam-dom-debug] addSaveButtonsToRows: firstCell not found for row date="${info.date}"`,
      )
      continue
    }
    addedCount++
    firstCell.setAttribute('data-npu-save-host', 'true')
    ;(firstCell as HTMLElement).style.position = 'relative'

    const saveSlot = document.createElement('div')
    saveSlot.className = 'npu-exam-save-slot'
    saveSlot.style.cssText = 'position: absolute; top: 8px; right: 8px; z-index: 3;'

    const saveBtn = document.createElement('button')
    saveBtn.className = 'npu-exam-save-btn'
    saveBtn.style.cssText =
      'padding: 2px 8px; background: #f6faff; color: #0f5bd8; border: 1px solid #b7cdf8; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 600; letter-spacing: 0; box-shadow: none;'
    saveBtn.textContent = 'Save'
    saveBtn.title = `Save "${info.date}" as preferred exam date for ${resolvedSubjectCode}`
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      onSave(resolvedSubjectCode, info.date, info.type, info.courseCode)
    })

    saveSlot.appendChild(saveBtn)
    firstCell.appendChild(saveSlot)
  }
  api?.logger.info(`[exam-dom-debug] addSaveButtonsToRows: added ${addedCount} save buttons`)
  return {
    addedCount,
    rowCount: rows.length,
  }
}

function isOwnInjectedNode(node: Node): boolean {
  if (node instanceof Element) {
    if (node.closest('#npu-status-root')) return true
    if (node.classList.contains('npu-exam-save-slot') || node.closest('.npu-exam-save-slot'))
      return true
    if (node.classList.contains('npu-exam-save-btn') || node.closest('.npu-exam-save-btn'))
      return true
    return false
  }

  const parent = node.parentElement
  return !!parent?.closest('#npu-status-root, .npu-exam-save-slot, .npu-exam-save-btn')
}

function scheduleSaveButtonRefresh(
  subjectCode: string | null,
  onSave: (subjectCode: string, date: string, type: string, courseCode: string) => void,
  delayMs: number,
): void {
  const currentTimer = getDebounceTimer()
  if (currentTimer) clearTimeout(currentTimer)

  setDebounceTimer(
    setTimeout(() => {
      setDebounceTimer(null)
      if (getIsDisposed()) return

      if (getIsEnrollmentInProgress()) {
        scheduleSaveButtonRefresh(subjectCode, onSave, 500)
        return
      }

      addSaveButtonsToRows(subjectCode, onSave)
    }, delayMs),
  )
}

export function watchTableForReRenders(
  subjectCode: string | null,
  onSave: (subjectCode: string, date: string, type: string, courseCode: string) => void,
): void {
  const api = getApi()
  getTableObserver()?.disconnect()
  const timer = getDebounceTimer()
  if (timer) {
    clearTimeout(timer)
    setDebounceTimer(null)
  }
  const observerTarget = document.querySelector('main') ?? document.body
  if (!observerTarget) {
    api?.logger.info('[exam-dom-debug] watchTableForReRenders: skipping, no observer target')
    return
  }

  const newObserver = new MutationObserver((mutations) => {
    if (getIsDisposed()) return

    const hasRelevantMutation = mutations.some((mutation) => {
      if (isOwnInjectedNode(mutation.target)) return false

      const changedNodes = [
        ...Array.from(mutation.addedNodes),
        ...Array.from(mutation.removedNodes),
      ]
      if (changedNodes.length === 0) return false

      return changedNodes.some((node) => {
        if (isOwnInjectedNode(node)) return false
        return true
      })
    })

    if (!hasRelevantMutation) return

    scheduleSaveButtonRefresh(subjectCode, onSave, getIsEnrollmentInProgress() ? 500 : 300)
  })
  newObserver.observe(observerTarget, { childList: true, subtree: true })
  setTableObserver(newObserver)
  api?.logger.info(
    '[exam-dom-debug] watchTableForReRenders: MutationObserver attached to page container',
  )
}

export function highlightSavedRow(pref: { date: string }): void {
  clearHighlights()
  const rows = getExamRows()
  for (const row of rows) {
    const info = parseExamRow(row)
    if (info.date === pref.date) {
      row.setAttribute('style', HIGHLIGHT_STYLE)
      row.setAttribute('data-npu-highlighted', 'true')
    }
  }
}

export function clearHighlights(): void {
  const highlighted = document.querySelectorAll('[data-npu-highlighted]')
  highlighted.forEach((el) => {
    ;(el as HTMLElement).removeAttribute('style')
    el.removeAttribute('data-npu-highlighted')
  })
}
