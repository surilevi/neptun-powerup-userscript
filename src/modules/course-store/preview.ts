import {
  extractCourseCode,
  expandPanel,
  findSubjectPanel,
  getCourseItems,
  isCourseSelected,
  isEnrollButtonText,
} from './dom'
import { isElementAvailable } from '../../utils/element-availability'
import { getApi } from './state'
import { loadSelections } from './storage'
import { collectPlannerSnapshot } from './planner'
import { createPlannerDiagnostics } from './planner-diagnostics'

const PREVIEW_STYLE_ID = 'npu-course-preview-style'
const PREVIEW_ATTRIBUTE = 'data-npu-course-preview'
let previewInFlight: Promise<CoursePreviewResult> | null = null
let plannerPreviewInFlight: Promise<PlannerPreviewResult> | null = null

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

export interface PlannerPreviewResult {
  diagnosticRunId: string
  contentReady: boolean
  plannedSubjects: number
  plannedCourses: number
  enrollableSubjects: number
  unavailableSubjects: number
  openedPlanner: boolean
  switchedToList: boolean
  issues: string[]
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
    [${PREVIEW_ATTRIBUTE}="unavailable-subject"] {
      outline: 2px solid #d64545 !important;
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

export function clearCoursePreview(): void {
  document.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(PREVIEW_ATTRIBUTE)
  })
}

async function runCoursePreview(): Promise<CoursePreviewResult> {
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
    api?.statusPanel.addMessage(
      'info',
      'No saved courses to preview. No course selections or enrollment buttons were clicked.',
    )
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

    const expanded = await expandPanel(panel)
    if (!expanded) {
      result.missing.push(`${subjectCode}: subject panel could not be expanded`)
      continue
    }

    const livePanel = findSubjectPanel(subjectCode) ?? panel
    livePanel.setAttribute(PREVIEW_ATTRIBUTE, 'subject')
    const items = getCourseItems(livePanel)
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

    const enrollmentButton = findEnrollmentButton(livePanel)
    if (!enrollmentButton) {
      result.missing.push(`${subjectCode}: enrollment button not visible`)
      continue
    }

    result.enrollmentButtons++
    if (isElementAvailable(enrollmentButton)) {
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
    `Preview: ${result.matchedCourses}/${result.savedCourses} saved courses matched; ${result.availableEnrollmentButtons}/${result.enrollmentButtons} enrollment buttons available. No course selections or enrollment buttons were clicked.`,
  )

  return result
}

export function previewSavedCourses(): Promise<CoursePreviewResult> {
  if (previewInFlight) return previewInFlight

  const run = runCoursePreview()
  previewInFlight = run
  const clearInFlight = (): void => {
    if (previewInFlight === run) previewInFlight = null
  }
  run.then(clearInFlight, clearInFlight)
  return run
}

async function runPlannerPreview(): Promise<PlannerPreviewResult> {
  const api = getApi()

  clearCoursePreview()
  ensurePreviewStyle()

  const diagnostics = createPlannerDiagnostics('preview')
  diagnostics.log('preview:start')
  const snapshot = await collectPlannerSnapshot({
    diagnostics,
    operation: 'preview',
  })
  const result: PlannerPreviewResult = {
    diagnosticRunId: snapshot.diagnosticRunId,
    contentReady: snapshot.contentReady,
    plannedSubjects: snapshot.subjects.length,
    plannedCourses: snapshot.subjects.reduce((sum, subject) => sum + subject.courseCodes.length, 0),
    enrollableSubjects: snapshot.subjects.filter((subject) => subject.available).length,
    unavailableSubjects: snapshot.subjects.filter((subject) => !subject.available).length,
    openedPlanner: snapshot.preparation.openedPlanner,
    switchedToList: snapshot.preparation.switchedToList,
    issues: snapshot.issues,
  }

  for (const subject of snapshot.subjects) {
    subject.panel.setAttribute(
      PREVIEW_ATTRIBUTE,
      subject.available ? 'subject' : 'unavailable-subject',
    )
    subject.selectedCourseItems.forEach((item) => {
      item.setAttribute(PREVIEW_ATTRIBUTE, 'selected-course')
    })

    if (subject.enrollmentButton) {
      subject.enrollmentButton.setAttribute(
        PREVIEW_ATTRIBUTE,
        subject.available ? 'enrollment-button' : 'unavailable-enrollment-button',
      )
    }
  }

  api?.logger.info('planner preview result', result)
  diagnostics.log('preview:complete', {
    contentReady: result.contentReady,
    plannedSubjects: result.plannedSubjects,
    plannedCourses: result.plannedCourses,
    enrollableSubjects: result.enrollableSubjects,
    issueCount: result.issues.length,
  })
  if (!result.contentReady) {
    api?.statusPanel.addMessage(
      'warn',
      `Planner preview could not read a fully loaded subject list: ${result.issues.join('; ')}. No course, planner-selection, or enrollment controls were clicked. Console run: ${result.diagnosticRunId}.`,
    )
    return result
  }

  api?.statusPanel.addMessage(
    result.issues.length === 0 ? 'info' : 'warn',
    `Planner preview: ${result.enrollableSubjects}/${result.plannedSubjects} subjects ready; ${result.plannedCourses} planned courses found. Only planner view controls and subject headers may have been opened. No course, planner-selection, or enrollment controls were clicked. Console run: ${result.diagnosticRunId}.`,
  )

  return result
}

export function previewPlannedCourses(): Promise<PlannerPreviewResult> {
  if (plannerPreviewInFlight) return plannerPreviewInFlight

  const run = runPlannerPreview()
  plannerPreviewInFlight = run
  const clearInFlight = (): void => {
    if (plannerPreviewInFlight === run) plannerPreviewInFlight = null
  }
  run.then(clearInFlight, clearInFlight)
  return run
}
