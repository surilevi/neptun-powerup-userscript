import {
  extractCourseCode,
  findSubjectPanel,
  getCourseItems,
  isCourseSelected,
  isEnrollButtonText,
} from './dom'
import { getApi } from './state'
import { loadSelections } from './storage'

const PREVIEW_STYLE_ID = 'npu-course-preview-style'
const PREVIEW_ATTRIBUTE = 'data-npu-course-preview'

export interface CoursePreviewResult {
  savedSubjects: number
  matchedSubjects: number
  savedCourses: number
  matchedCourses: number
  selectedCourses: number
  enrollmentButtons: number
  availableEnrollmentButtons: number
  missing: string[]
}

function normalizeCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

function ensurePreviewStyle(): void {
  if (document.getElementById(PREVIEW_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = PREVIEW_STYLE_ID
  style.textContent = `
    [${PREVIEW_ATTRIBUTE}="subject"] {
      outline: 2px solid #4f8cff !important;
      outline-offset: 2px !important;
    }
    [${PREVIEW_ATTRIBUTE}="course"] {
      box-shadow: inset 4px 0 0 #4f8cff !important;
      background: rgba(79, 140, 255, 0.12) !important;
    }
    [${PREVIEW_ATTRIBUTE}="selected-course"] {
      box-shadow: inset 4px 0 0 #22a06b !important;
      background: rgba(34, 160, 107, 0.14) !important;
    }
    [${PREVIEW_ATTRIBUTE}="enrollment-button"] {
      outline: 3px solid #ffb020 !important;
      outline-offset: 2px !important;
    }
    [${PREVIEW_ATTRIBUTE}="unavailable-enrollment-button"] {
      outline: 3px solid #d64545 !important;
      outline-offset: 2px !important;
    }
  `
  document.head.appendChild(style)
}

function findEnrollmentButton(panel: Element): HTMLButtonElement | null {
  const buttons = Array.from(panel.querySelectorAll('button'))
  return buttons.find((button) => isEnrollButtonText(button.textContent ?? '')) ?? null
}

function isButtonAvailable(button: HTMLButtonElement): boolean {
  if (!button.isConnected || button.disabled || button.hasAttribute('disabled')) return false
  if (button.getAttribute('aria-disabled') === 'true') return false

  const style = window.getComputedStyle(button)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none'
}

export function clearCoursePreview(): void {
  document.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(PREVIEW_ATTRIBUTE)
  })
}

export async function previewSavedCourses(): Promise<CoursePreviewResult> {
  const api = getApi()
  const selections = await loadSelections()
  const entries = Object.entries(selections)

  clearCoursePreview()
  ensurePreviewStyle()

  const result: CoursePreviewResult = {
    savedSubjects: entries.length,
    matchedSubjects: 0,
    savedCourses: Object.values(selections).reduce((sum, codes) => sum + codes.length, 0),
    matchedCourses: 0,
    selectedCourses: 0,
    enrollmentButtons: 0,
    availableEnrollmentButtons: 0,
    missing: [],
  }

  if (entries.length === 0) {
    api?.statusPanel.addMessage('info', 'No saved courses to preview. No clicks were made.')
    return result
  }

  for (const [subjectCode, courseCodes] of entries) {
    const panel = findSubjectPanel(subjectCode)
    if (!panel) {
      result.missing.push(`${subjectCode}: subject not visible`)
      continue
    }

    result.matchedSubjects++
    panel.setAttribute(PREVIEW_ATTRIBUTE, 'subject')

    const items = getCourseItems(panel)
    for (const courseCode of courseCodes) {
      const normalizedSavedCode = normalizeCode(courseCode)
      const item = items.find((candidate) => {
        const visibleCode = extractCourseCode(candidate)
        return visibleCode !== null && normalizeCode(visibleCode) === normalizedSavedCode
      })

      if (!item) {
        result.missing.push(`${subjectCode}: ${courseCode} not visible`)
        continue
      }

      result.matchedCourses++
      if (isCourseSelected(item)) {
        result.selectedCourses++
        item.setAttribute(PREVIEW_ATTRIBUTE, 'selected-course')
      } else {
        item.setAttribute(PREVIEW_ATTRIBUTE, 'course')
      }
    }

    const enrollmentButton = findEnrollmentButton(panel)
    if (!enrollmentButton) {
      result.missing.push(`${subjectCode}: enrollment button not visible`)
      continue
    }

    result.enrollmentButtons++
    if (isButtonAvailable(enrollmentButton)) {
      result.availableEnrollmentButtons++
      enrollmentButton.setAttribute(PREVIEW_ATTRIBUTE, 'enrollment-button')
    } else {
      enrollmentButton.setAttribute(PREVIEW_ATTRIBUTE, 'unavailable-enrollment-button')
      result.missing.push(`${subjectCode}: enrollment button unavailable`)
    }
  }

  api?.logger.info('course preview result', result)
  api?.statusPanel.addMessage(
    result.missing.length === 0 ? 'info' : 'warn',
    `Preview: ${result.matchedCourses}/${result.savedCourses} saved courses matched; ${result.availableEnrollmentButtons}/${result.enrollmentButtons} enrollment buttons available. No clicks were made.`,
  )

  return result
}
