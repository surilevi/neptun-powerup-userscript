import { SESSION_STORAGE_KEYS } from '../../types/neptun-api'
import { delay } from '../../utils/async'
import { isElementAvailable } from '../../utils/element-availability'
import { extractSubjectCode, isEnrollButtonText } from './dom'
import { createPlannerDiagnostics } from './planner-diagnostics'
import { PLANNER_TIMING } from './planner-policy'
import {
  collectPlannerSnapshot,
  getPlannerListRoot,
  getPlannerSubjectPanels,
  readPlannerSubjectTarget,
  type PlannerSubjectTarget,
} from './planner'
import { getApi, getIsEnrolling, setIsEnrolling } from './state'

const ENROLLMENT_ENDPOINT = 'SubjectApplication/SubjectSignin'

export interface PlannerEnrollmentOptions {
  plannerWaitTimeoutMs?: number
}

export interface PlannerEnrollmentResult {
  plannerReady: boolean
  openedPlanner: boolean
  listedSubjects: number
  plannedSubjects: number
  eligibleSubjects: number
  attempted: number
  enrolled: number
  failed: number
  skipped: number
  aborted: boolean
  errors: string[]
}

type EnrollmentOutcome =
  | { type: 'request'; status: number | null }
  | { type: 'confirmation-required' }
  | { type: 'timeout' }

let plannerEnrollmentInFlight: Promise<PlannerEnrollmentResult> | null = null

function emptyResult(error?: string): PlannerEnrollmentResult {
  return {
    plannerReady: false,
    openedPlanner: false,
    listedSubjects: 0,
    plannedSubjects: 0,
    eligibleSubjects: 0,
    attempted: 0,
    enrolled: 0,
    failed: 0,
    skipped: 0,
    aborted: false,
    errors: error ? [error] : [],
  }
}

function normalizeCodes(codes: string[]): string[] {
  return codes.map((code) => code.replace(/\s+/g, '').toUpperCase()).sort()
}

function courseSelectionMatches(expected: string[], actual: string[]): boolean {
  const normalizedExpected = normalizeCodes(expected)
  const normalizedActual = normalizeCodes(actual)
  return (
    normalizedExpected.length === normalizedActual.length &&
    normalizedExpected.every((code, index) => code === normalizedActual[index])
  )
}

function isEnrollmentConfirmationDialog(dialog: HTMLElement): boolean {
  const text = (dialog.textContent ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const confirmationText =
    text.includes('confirm subject registration') ||
    text.includes('biztosan felveszi') ||
    text.includes('targyfelvetel megerositese')
  if (confirmationText) return true

  const buttonLabels = Array.from(dialog.querySelectorAll('button')).map((button) =>
    (button.textContent ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase(),
  )
  const hasAccept = buttonLabels.some((label) => ['igen', 'yes', 'ok'].includes(label))
  const hasReject = buttonLabels.some((label) => ['nem', 'no', 'megse', 'cancel'].includes(label))
  return hasAccept && hasReject
}

function getVisibleDialogs(): Element[] {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container',
    ),
  )
  return dialogs.filter(
    (dialog) => isElementAvailable(dialog) && isEnrollmentConfirmationDialog(dialog),
  )
}

function getVisibleNotificationState(): string {
  const notifications = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.cdk-overlay-pane, [role="status"], [aria-live="polite"], [aria-live="assertive"]',
    ),
  ).filter((element) => isElementAvailable(element) && !isEnrollmentConfirmationDialog(element))

  return notifications
    .map((element) =>
      (element.textContent ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    .join('|')
}

function isFailureNotification(text: string): boolean {
  return ['sikertelen', 'failed', 'hiba', 'error', 'nincs targyjelentkezesi idoszak'].some(
    (marker) => text.includes(marker),
  )
}

function getEnrollmentRequests(): PerformanceResourceTiming[] {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    return entries.filter((entry) => entry.name.includes(ENROLLMENT_ENDPOINT))
  } catch {
    return []
  }
}

async function waitForEnrollmentOutcome(
  requestsBeforeClick: number,
  dialogsBeforeClick: Set<Element>,
  timeoutMs: number = PLANNER_TIMING.enrollmentRequestTimeoutMs,
): Promise<EnrollmentOutcome> {
  const startedWaitingAt = Date.now()

  while (Date.now() - startedWaitingAt < timeoutMs) {
    const confirmationDialog = getVisibleDialogs().find((dialog) => !dialogsBeforeClick.has(dialog))
    if (confirmationDialog) return { type: 'confirmation-required' }

    const requests = getEnrollmentRequests()
    const request = requests.length > requestsBeforeClick ? requests[requests.length - 1] : null
    if (request) {
      const responseStatus = (request as PerformanceResourceTiming & { responseStatus?: number })
        .responseStatus
      return {
        type: 'request',
        status: typeof responseStatus === 'number' ? responseStatus : null,
      }
    }

    await delay(PLANNER_TIMING.outcomePollIntervalMs)
  }

  return { type: 'timeout' }
}

function hasVisibleEnrollmentAction(subjectCode: string): boolean {
  const root = getPlannerListRoot()
  if (!root) return false

  return getPlannerSubjectPanels(root)
    .filter((panel) => extractSubjectCode(panel) === subjectCode)
    .some((panel) =>
      Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).some(
        (button) => isEnrollButtonText(button.textContent ?? '') && isElementAvailable(button),
      ),
    )
}

type PlannerUiOutcome = 'updated' | 'failure-notification' | 'timeout'

async function waitForPlannerUiOutcome(
  subjectCode: string,
  previousButton: HTMLButtonElement,
  notificationStateBeforeClick: string,
  timeoutMs: number = PLANNER_TIMING.enrollmentUiUpdateTimeoutMs,
): Promise<PlannerUiOutcome> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (!previousButton.isConnected && !hasVisibleEnrollmentAction(subjectCode)) {
      return 'updated'
    }
    if (!hasVisibleEnrollmentAction(subjectCode)) return 'updated'

    const notificationState = getVisibleNotificationState()
    if (
      notificationState !== notificationStateBeforeClick &&
      isFailureNotification(notificationState)
    ) {
      return 'failure-notification'
    }

    await delay(PLANNER_TIMING.outcomePollIntervalMs)
  }

  return 'timeout'
}

function validateTarget(target: PlannerSubjectTarget): PlannerSubjectTarget | null {
  const liveTarget = readPlannerSubjectTarget(target.subjectCode, target.panel)
  if (
    !liveTarget ||
    !liveTarget.available ||
    !liveTarget.enrollmentButton ||
    !courseSelectionMatches(target.courseCodes, liveTarget.courseCodes)
  ) {
    return null
  }

  return liveTarget
}

async function runPlannerEnrollment(
  options: PlannerEnrollmentOptions,
): Promise<PlannerEnrollmentResult> {
  const api = getApi()
  const diagnostics = createPlannerDiagnostics('enroll')
  const readinessTimeoutMs =
    options.plannerWaitTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs
  diagnostics.log('enroll:start', {
    readinessTimeoutMs,
    requestTimeoutMs: PLANNER_TIMING.enrollmentRequestTimeoutMs,
    uiUpdateTimeoutMs: PLANNER_TIMING.enrollmentUiUpdateTimeoutMs,
  })
  const snapshot = await collectPlannerSnapshot({
    entryPointTimeoutMs: readinessTimeoutMs,
    contentTimeoutMs: readinessTimeoutMs,
    diagnostics,
    operation: 'enroll',
  })
  const eligibleTargets = snapshot.subjects.filter(
    (subject) => subject.available && subject.enrollmentButton,
  )
  const result: PlannerEnrollmentResult = {
    plannerReady: snapshot.preparation.root !== null && snapshot.contentReady,
    openedPlanner: snapshot.preparation.openedPlanner,
    listedSubjects: snapshot.listedSubjects,
    plannedSubjects: snapshot.subjects.length,
    eligibleSubjects: eligibleTargets.length,
    attempted: 0,
    enrolled: 0,
    failed: 0,
    skipped: snapshot.subjects.length - eligibleTargets.length,
    aborted: false,
    errors: [...snapshot.issues],
  }
  diagnostics.log('enroll:targets', {
    listedSubjects: result.listedSubjects,
    readableSubjects: result.plannedSubjects,
    eligibleSubjects: result.eligibleSubjects,
    skippedSubjects: result.skipped,
  })

  if (!snapshot.preparation.root || !snapshot.contentReady) {
    diagnostics.log('enroll:blocked', { reason: 'planner-not-ready' })
    api?.statusPanel.addMessage(
      'warn',
      `${
        snapshot.preparation.error ??
        (snapshot.issues.join('; ') || 'Neptun timetable planner list is unavailable.')
      } Console run: ${diagnostics.runId}.`,
    )
    return result
  }

  if (eligibleTargets.length === 0) {
    diagnostics.log('enroll:blocked', { reason: 'no-eligible-targets' })
    api?.statusPanel.addMessage(
      'warn',
      `No enrollable planned subjects were found. Preview the planner and review unavailable items. Console run: ${diagnostics.runId}.`,
    )
    return result
  }

  try {
    const token = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
    if (!token) {
      result.aborted = true
      result.errors.push('Session expired')
      diagnostics.log('enroll:blocked', { reason: 'session-expired' })
      api?.statusPanel.addMessage(
        'error',
        `Session expired. Log in again before enrolling. Console run: ${diagnostics.runId}.`,
      )
      return result
    }
  } catch (error) {
    api?.logger.warn('cannot check sessionStorage before planner enrollment:', error)
  }

  api?.statusPanel.expand()
  api?.statusPanel.addMessage(
    'info',
    `Enrolling ${eligibleTargets.length} planned subject${eligibleTargets.length === 1 ? '' : 's'} sequentially...`,
  )

  for (const [targetIndex, target] of eligibleTargets.entries()) {
    const liveTarget = validateTarget(target)
    if (!liveTarget?.enrollmentButton) {
      result.failed++
      result.errors.push(`${target.subjectCode}: planner selection changed before enrollment`)
      diagnostics.log('target:skipped', {
        targetIndex,
        reason: 'selection-changed',
      })
      continue
    }

    result.attempted++
    api?.statusPanel.addMessage(
      'info',
      `Enrolling ${target.subjectCode}... (${result.attempted}/${eligibleTargets.length})`,
    )

    const dialogsBeforeClick = new Set(getVisibleDialogs())
    const notificationStateBeforeClick = getVisibleNotificationState()
    const requestsBeforeClick = getEnrollmentRequests().length
    const enrollmentButton = liveTarget.enrollmentButton
    diagnostics.log('target:click', {
      targetIndex,
      targetCount: eligibleTargets.length,
      priorRequestCount: requestsBeforeClick,
    })
    enrollmentButton.click()

    const outcome = await waitForEnrollmentOutcome(requestsBeforeClick, dialogsBeforeClick)
    diagnostics.log('target:request-outcome', {
      targetIndex,
      outcome: outcome.type,
      status: outcome.type === 'request' ? outcome.status : null,
    })
    if (outcome.type === 'confirmation-required') {
      result.failed++
      result.aborted = true
      result.errors.push(`${target.subjectCode}: Neptun registration confirmation popup is enabled`)
      api?.statusPanel.addMessage(
        'error',
        `Neptun opened a registration confirmation. Complete or cancel it manually, enable “do not show again,” then retry. Remaining subjects were not clicked. Console run: ${diagnostics.runId}.`,
      )
      break
    }

    if (outcome.type === 'timeout') {
      result.failed++
      result.errors.push(`${target.subjectCode}: timed out waiting for Neptun`)
      continue
    }

    if (outcome.status !== null && outcome.status >= 400) {
      result.failed++
      result.errors.push(`${target.subjectCode}: server returned ${outcome.status}`)
      continue
    }

    const uiOutcome = await waitForPlannerUiOutcome(
      target.subjectCode,
      enrollmentButton,
      notificationStateBeforeClick,
    )
    diagnostics.log('target:ui-outcome', {
      targetIndex,
      outcome: uiOutcome,
    })
    if (uiOutcome === 'failure-notification') {
      result.failed++
      result.errors.push(`${target.subjectCode}: Neptun reported enrollment failure`)
      continue
    }

    if (uiOutcome === 'timeout') {
      result.failed++
      result.errors.push(
        `${target.subjectCode}: request completed but planner did not confirm enrollment`,
      )
      continue
    }

    result.enrolled++
  }

  const summary = `Planner enrollment: ${result.enrolled} enrolled, ${result.failed} failed, ${result.skipped} skipped.${result.aborted ? ' Stopped safely.' : ''}`
  const summaryWithRunId = `${summary} Console run: ${diagnostics.runId}.`
  diagnostics.log('enroll:complete', {
    enrolled: result.enrolled,
    failed: result.failed,
    skipped: result.skipped,
    aborted: result.aborted,
  })
  api?.logger.info(summary, result)
  api?.statusPanel.addMessage(
    result.failed === 0 && !result.aborted ? 'info' : 'warn',
    result.errors.length > 0 ? `${summaryWithRunId} ${result.errors.join('; ')}` : summaryWithRunId,
  )

  return result
}

export function enrollPlannedCourses(
  options: PlannerEnrollmentOptions = {},
): Promise<PlannerEnrollmentResult> {
  if (plannerEnrollmentInFlight) return plannerEnrollmentInFlight
  if (getIsEnrolling()) return Promise.resolve(emptyResult('Enrollment is already in progress'))

  setIsEnrolling(true)
  const run = runPlannerEnrollment(options)
  plannerEnrollmentInFlight = run
  const clearInFlight = (): void => {
    if (plannerEnrollmentInFlight === run) plannerEnrollmentInFlight = null
    setIsEnrolling(false)
  }
  run.then(clearInFlight, clearInFlight)
  return run
}
