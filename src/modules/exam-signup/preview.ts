import {
  buildTableSubjectCodeMap,
  getExamRows,
  getRowSubjectCode,
  getSubjectCode,
  parseExamRow,
} from './dom'
import { getApi } from './state'
import { loadPreferences } from './storage'

const PREVIEW_STYLE_ID = 'npu-exam-preview-style'
const PREVIEW_ATTRIBUTE = 'data-npu-exam-preview'

export interface ExamPreviewResult {
  savedExams: number
  matchedExams: number
  availableExams: number
  matchedRows: number
  enrollmentButtons: number
  availableEnrollmentButtons: number
  missing: string[]
}

function ensurePreviewStyle(): void {
  if (document.getElementById(PREVIEW_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = PREVIEW_STYLE_ID
  style.textContent = `
    [${PREVIEW_ATTRIBUTE}="row"] {
      box-shadow: inset 4px 0 0 #4f8cff !important;
      background: rgba(79, 140, 255, 0.12) !important;
    }
    [${PREVIEW_ATTRIBUTE}="enrollment-button"] {
      outline: 3px solid #ffb020 !important;
      outline-offset: 2px !important;
    }
    [${PREVIEW_ATTRIBUTE}="unavailable-row"] {
      box-shadow: inset 4px 0 0 #d64545 !important;
      background: rgba(214, 69, 69, 0.12) !important;
    }
    [${PREVIEW_ATTRIBUTE}="unavailable-enrollment-button"] {
      outline: 3px solid #d64545 !important;
      outline-offset: 2px !important;
    }
  `
  document.head.appendChild(style)
}

function isButtonAvailable(button: HTMLButtonElement): boolean {
  if (!button.isConnected || button.disabled || button.hasAttribute('disabled')) return false
  if (button.getAttribute('aria-disabled') === 'true') return false

  const style = window.getComputedStyle(button)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none'
}

export function clearExamPreview(): void {
  document.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(PREVIEW_ATTRIBUTE)
  })
}

export async function previewSavedExams(): Promise<ExamPreviewResult> {
  const api = getApi()
  const preferences = await loadPreferences()
  const entries = Object.entries(preferences)

  clearExamPreview()
  ensurePreviewStyle()

  const result: ExamPreviewResult = {
    savedExams: entries.length,
    matchedExams: 0,
    availableExams: 0,
    matchedRows: 0,
    enrollmentButtons: 0,
    availableEnrollmentButtons: 0,
    missing: [],
  }

  if (entries.length === 0) {
    api?.statusPanel.addMessage('info', 'No saved exams to preview. No clicks were made.')
    return result
  }

  const tableSubjectCodes = buildTableSubjectCodeMap()
  const pageSubjectCode = getSubjectCode()
  const matchedSubjects = new Set<string>()
  const availableSubjects = new Set<string>()

  for (const row of getExamRows()) {
    const subjectCode = getRowSubjectCode(row, tableSubjectCodes) ?? pageSubjectCode
    if (!subjectCode) continue

    const preference = preferences[subjectCode]
    if (!preference) continue

    const info = parseExamRow(row)
    if (info.date !== preference.date) continue

    matchedSubjects.add(subjectCode)
    result.matchedRows++

    if (info.felvetelBtn) {
      result.enrollmentButtons++
    }

    if (info.felvetelBtn && isButtonAvailable(info.felvetelBtn)) {
      result.availableEnrollmentButtons++
      availableSubjects.add(subjectCode)
      row.setAttribute(PREVIEW_ATTRIBUTE, 'row')
      info.felvetelBtn.setAttribute(PREVIEW_ATTRIBUTE, 'enrollment-button')
    } else {
      row.setAttribute(PREVIEW_ATTRIBUTE, 'unavailable-row')
      info.felvetelBtn?.setAttribute(PREVIEW_ATTRIBUTE, 'unavailable-enrollment-button')
    }
  }

  for (const [subjectCode, preference] of entries) {
    if (!matchedSubjects.has(subjectCode)) {
      result.missing.push(`${subjectCode}: ${preference.date} not visible`)
    } else if (!availableSubjects.has(subjectCode)) {
      result.missing.push(`${subjectCode}: ${preference.date} has no available enrollment button`)
    }
  }

  result.matchedExams = matchedSubjects.size
  result.availableExams = availableSubjects.size

  api?.logger.info('exam preview result', result)
  api?.statusPanel.addMessage(
    result.missing.length === 0 ? 'info' : 'warn',
    `Preview: ${result.matchedExams}/${result.savedExams} saved exams matched; ${result.availableEnrollmentButtons}/${result.enrollmentButtons} enrollment buttons available. No clicks were made.`,
  )

  return result
}
