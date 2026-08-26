import { SESSION_STORAGE_KEYS } from '../../types/neptun-api'
import { delay } from '../../utils/async'
import { isElementAvailable } from '../../utils/element-availability'
import { extractSubjectCode, isEnrollButtonText } from './dom'
import { createPlannerDiagnostics, type PlannerDiagnostics } from './planner-diagnostics'
import { PLANNER_TIMING } from './planner-policy'
import { fetchPlannedSubjects, fetchWarningModalStates, type PlannedSubject } from './planner-api'
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
  /** Clicked, but neither Neptun nor the API confirmed the outcome either way. */
  unconfirmed: number
  aborted: boolean
  errors: string[]
}

type EnrollmentOutcome =
  | { type: 'request'; status: number | null }
  | { type: 'confirmation-required' }
  | { type: 'timeout' }

/** `rejected` is Neptun definitively saying no — retrying that only spams the server. */
type EnrollmentConfirmation = 'registered' | 'rejected' | 'unknown'

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
    unconfirmed: 0,
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

function normalizeDialogText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isEnrollmentConfirmationDialog(dialog: HTMLElement): boolean {
  const text = normalizeDialogText(dialog.textContent ?? '')
  const confirmationText =
    text.includes('confirm subject registration') ||
    text.includes('biztosan felveszi') ||
    text.includes('targyfelvetel megerositese')
  if (confirmationText) return true

  const buttonLabels = Array.from(dialog.querySelectorAll('button')).map((button) =>
    normalizeDialogText(button.textContent ?? ''),
  )
  const hasAccept = buttonLabels.some((label) => ['igen', 'yes', 'ok'].includes(label))
  const hasReject = buttonLabels.some((label) => ['nem', 'no', 'megse', 'cancel'].includes(label))
  return hasAccept && hasReject
}

function getVisibleDialogs(): Element[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container',
    ),
  ).filter((dialog) => isElementAvailable(dialog) && isEnrollmentConfirmationDialog(dialog))
}

/**
 * Where Neptun renders the toast that explains an enrollment result.
 *
 * 2026.2.11 moved these into its own `neptun-push-notifications` component,
 * which carries no `aria-live` and sits in no overlay pane — so the original
 * Material selectors matched nothing and every failure lost its explanation.
 * Verified live on 2026-08-26: `.cdk-overlay-pane` matched 0 elements while the
 * only `aria-live` hits were empty form-field hints and the CDK announcer.
 * The older selectors stay for portals that have not moved yet.
 */
const NOTIFICATION_SELECTOR = [
  'neptun-push-notifications',
  '.push-notifications-wrapper',
  '.push-notifications',
  '.cdk-overlay-pane',
  '[role="status"]',
  '[role="alert"]',
  '[aria-live="polite"]',
  '[aria-live="assertive"]',
].join(', ')

function getVisibleNotificationState(): string {
  const texts = Array.from(document.querySelectorAll<HTMLElement>(NOTIFICATION_SELECTOR))
    .filter((element) => isElementAvailable(element) && !isEnrollmentConfirmationDialog(element))
    .map((element) => normalizeDialogText(element.textContent ?? ''))
    .filter(Boolean)

  // The host element commonly carries the wrapper class too, so the same toast
  // matches more than once. Deduplicate, or one notification reads as several.
  return Array.from(new Set(texts)).join('|')
}

function isFailureNotification(text: string): boolean {
  return ['sikertelen', 'failed', 'hiba', 'error', 'nincs targyjelentkezesi idoszak'].some(
    (marker) => text.includes(marker),
  )
}

/**
 * Conditions that apply to the whole run, not to one subject.
 *
 * Observed live: with registration closed, Neptun answers every enrollment with
 * HTTP 500 and "Jelenleg nincs tárgyjelentkezési időszak!". Continuing through
 * the remaining subjects just repeats the same rejection, so the run stops.
 */
const RUN_FATAL_NOTIFICATION_MARKERS = [
  'nincs targyjelentkezesi idoszak',
  'no subject registration period',
  'lejart a targyjelentkezesi idoszak',
]

function isRunFatalNotification(text: string): boolean {
  return RUN_FATAL_NOTIFICATION_MARKERS.some((marker) => text.includes(marker))
}

/**
 * Wait briefly for Neptun to render the notification explaining a failure.
 * The request completes before the toast appears, so reading immediately would
 * miss the only part of the response that says *why*.
 */
async function waitForNewNotification(
  notificationStateBeforeClick: string,
  timeoutMs: number = PLANNER_TIMING.notificationSettleMs,
): Promise<string> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const current = getVisibleNotificationState()
    if (current && current !== notificationStateBeforeClick) return current
    await delay(PLANNER_TIMING.outcomePollIntervalMs)
  }

  return getVisibleNotificationState()
}

type FailureClassification = 'run-fatal' | 'rejected' | 'retryable'

/**
 * Classify a failed enrollment request.
 *
 * Neptun does not use status codes semantically — a business-rule rejection and
 * a genuinely overloaded server both surface as 5xx — so the notification text
 * decides, and only a status with no explanation is assumed transient.
 */
function classifyFailure(status: number | null, notification: string): FailureClassification {
  if (isRunFatalNotification(notification)) return 'run-fatal'
  if (isFailureNotification(notification)) return 'rejected'
  if (status === 429 || status === 502 || status === 503 || status === 504) return 'retryable'
  return 'rejected'
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
      return { type: 'request', status: typeof responseStatus === 'number' ? responseStatus : null }
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
  notificationStateBeforeClick: string,
  timeoutMs: number = PLANNER_TIMING.enrollmentUiUpdateTimeoutMs,
): Promise<PlannerUiOutcome> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
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

/**
 * Decide whether a subject really got registered.
 *
 * Neptun's API is authoritative, so it is asked first; the DOM heuristic is only
 * the fallback for when the API is unavailable. The distinction between
 * "not registered" and "unknown" matters: the former is safe to retry, the
 * latter must be surfaced rather than silently retried or counted as a failure.
 */
async function confirmEnrollment(
  subjectCode: string,
  apiUsable: boolean,
  notificationStateBeforeClick: string,
  diagnostics: PlannerDiagnostics,
): Promise<EnrollmentConfirmation> {
  if (apiUsable) {
    await delay(PLANNER_TIMING.apiConfirmationDelayMs)
    const refreshed = await fetchPlannedSubjects().catch(() => null)

    if (refreshed?.ok) {
      const match = refreshed.subjects.find((subject) => subject.code === subjectCode)
      diagnostics.log('confirm:api', {
        found: match !== undefined,
        isRegistered: match?.isRegistered ?? null,
      })

      // A subject that vanished from the planned list was consumed by the
      // enrollment; an explicit isRegistered flag is the clearest signal.
      if (!match) return 'registered'
      return match.isRegistered ? 'registered' : 'rejected'
    }

    diagnostics.log('confirm:api-unavailable', { failure: refreshed?.failure ?? 'error' })
  }

  const uiOutcome = await waitForPlannerUiOutcome(subjectCode, notificationStateBeforeClick)
  diagnostics.log('confirm:ui', { outcome: uiOutcome })

  if (uiOutcome === 'updated') return 'registered'
  if (uiOutcome === 'failure-notification') return 'rejected'
  return 'unknown'
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

interface SubjectAttemptResult {
  outcome: 'enrolled' | 'failed' | 'unconfirmed' | 'aborted' | 'selection-changed' | 'run-fatal'
  error: string | null
}

/**
 * Enroll one subject, retrying only when the server was ambiguous.
 *
 * A 429/5xx is worth another try — that is an overloaded registration server,
 * not an answer. A definitive rejection, a non-retryable status, or a timeout
 * whose click may already have landed are all reported instead, so NPU never
 * hammers Neptun or double-submits.
 */
async function enrollSingleSubject(
  target: PlannerSubjectTarget,
  apiUsable: boolean,
  diagnostics: PlannerDiagnostics,
  targetIndex: number,
): Promise<SubjectAttemptResult> {
  let lastError = `${target.subjectCode}: enrollment did not complete`

  for (let attempt = 1; attempt <= PLANNER_TIMING.enrollmentMaxAttempts; attempt++) {
    const liveTarget = validateTarget(target)
    if (!liveTarget?.enrollmentButton) {
      // Between retries the button legitimately disappears once enrollment lands.
      if (attempt > 1) {
        const confirmation = await confirmEnrollment(target.subjectCode, apiUsable, '', diagnostics)
        if (confirmation === 'registered') return { outcome: 'enrolled', error: null }
        return { outcome: 'failed', error: lastError }
      }
      return {
        outcome: 'selection-changed',
        error: `${target.subjectCode}: planner selection changed before enrollment`,
      }
    }

    const dialogsBeforeClick = new Set(getVisibleDialogs())
    const notificationStateBeforeClick = getVisibleNotificationState()
    const requestsBeforeClick = getEnrollmentRequests().length

    diagnostics.log('target:click', {
      targetIndex,
      attempt,
      priorRequestCount: requestsBeforeClick,
    })
    liveTarget.enrollmentButton.click()

    const outcome = await waitForEnrollmentOutcome(requestsBeforeClick, dialogsBeforeClick)
    diagnostics.log('target:request-outcome', {
      targetIndex,
      attempt,
      outcome: outcome.type,
      status: outcome.type === 'request' ? outcome.status : null,
    })

    if (outcome.type === 'confirmation-required') {
      return {
        outcome: 'aborted',
        error: `${target.subjectCode}: Neptun registration confirmation popup is enabled`,
      }
    }

    if (outcome.type === 'timeout') {
      // The click may still have been processed server-side. Ask, then report —
      // re-clicking a request that might have landed is worse than reporting it.
      const confirmation = await confirmEnrollment(
        target.subjectCode,
        apiUsable,
        notificationStateBeforeClick,
        diagnostics,
      )
      if (confirmation === 'registered') return { outcome: 'enrolled', error: null }
      return {
        outcome: confirmation === 'rejected' ? 'failed' : 'unconfirmed',
        error: `${target.subjectCode}: timed out waiting for Neptun`,
      }
    }

    if (outcome.status !== null && outcome.status >= 400) {
      // Neptun explains the refusal in a notification rather than in the status
      // code, so read it before deciding whether another attempt is warranted.
      const notification = await waitForNewNotification(notificationStateBeforeClick)
      const classification = classifyFailure(outcome.status, notification)
      diagnostics.log('target:failure-classified', {
        targetIndex,
        attempt,
        status: outcome.status,
        classification,
      })

      lastError = `${target.subjectCode}: server returned ${outcome.status}`

      if (classification === 'run-fatal') {
        return {
          outcome: 'run-fatal',
          error: `${target.subjectCode}: Neptun reports there is no open registration period`,
        }
      }

      if (classification === 'rejected') {
        return { outcome: 'failed', error: lastError }
      }

      if (attempt < PLANNER_TIMING.enrollmentMaxAttempts) {
        diagnostics.log('target:retry', { targetIndex, attempt, status: outcome.status })
        await delay(PLANNER_TIMING.enrollmentRetryBaseDelayMs * attempt)
      }
      continue
    }

    const confirmation = await confirmEnrollment(
      target.subjectCode,
      apiUsable,
      notificationStateBeforeClick,
      diagnostics,
    )
    if (confirmation === 'registered') return { outcome: 'enrolled', error: null }
    if (confirmation === 'rejected') {
      return {
        outcome: 'failed',
        error: `${target.subjectCode}: Neptun reported enrollment failure`,
      }
    }

    return {
      outcome: 'unconfirmed',
      error: `${target.subjectCode}: request completed but enrollment could not be confirmed`,
    }
  }

  return { outcome: 'failed', error: lastError }
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
    maxAttemptsPerSubject: PLANNER_TIMING.enrollmentMaxAttempts,
  })

  const snapshot = await collectPlannerSnapshot({
    entryPointTimeoutMs: readinessTimeoutMs,
    contentTimeoutMs: readinessTimeoutMs,
    diagnostics,
    operation: 'enroll',
  })

  const apiUsable = snapshot.plannedFromApi !== null
  const registeredCodes = new Set(
    (snapshot.plannedFromApi ?? [])
      .filter((subject: PlannedSubject) => subject.isRegistered)
      .map((subject: PlannedSubject) => subject.code),
  )

  const eligibleTargets = snapshot.subjects.filter(
    (subject) =>
      subject.available && subject.enrollmentButton && !registeredCodes.has(subject.subjectCode),
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
    unconfirmed: 0,
    aborted: false,
    errors: [...snapshot.issues],
  }

  diagnostics.log('enroll:targets', {
    listedSubjects: result.listedSubjects,
    readableSubjects: result.plannedSubjects,
    eligibleSubjects: result.eligibleSubjects,
    skippedSubjects: result.skipped,
    alreadyRegistered: registeredCodes.size,
    apiUsable,
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
      registeredCodes.size > 0 && registeredCodes.size === snapshot.subjects.length
        ? `All ${registeredCodes.size} planned subjects are already registered. Nothing was clicked.`
        : `No enrollable planned subjects were found. Preview the planner and review unavailable items. Console run: ${diagnostics.runId}.`,
    )
    return result
  }

  try {
    if (!sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)) {
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

  // Neptun's confirmation popup stops the whole run. Warn about it before the
  // first click rather than discovering it halfway through.
  const warningStates = await fetchWarningModalStates().catch(() => null)
  if (warningStates?.scheduledCoursesInTimetableSuppressed === false) {
    diagnostics.log('enroll:warning-modal-active')
    api?.statusPanel.addMessage(
      'warn',
      'Neptun’s registration confirmation popup is still enabled. If it appears, the run stops safely — tick “do not show again” in Neptun to avoid that.',
    )
  }

  api?.statusPanel.expand()
  api?.statusPanel.addMessage(
    'info',
    `Enrolling ${eligibleTargets.length} planned subject${eligibleTargets.length === 1 ? '' : 's'} sequentially...`,
  )

  for (const [targetIndex, target] of eligibleTargets.entries()) {
    // Re-read the target immediately before acting: the planner may have changed
    // under us while earlier subjects were being enrolled.
    if (!validateTarget(target)?.enrollmentButton) {
      result.failed++
      result.errors.push(`${target.subjectCode}: planner selection changed before enrollment`)
      diagnostics.log('target:skipped', { targetIndex, reason: 'selection-changed' })
      continue
    }

    result.attempted++
    api?.statusPanel.addMessage(
      'info',
      `Enrolling ${target.subjectCode}... (${result.attempted}/${eligibleTargets.length})`,
    )

    const attemptResult = await enrollSingleSubject(target, apiUsable, diagnostics, targetIndex)
    if (attemptResult.error) result.errors.push(attemptResult.error)

    if (attemptResult.outcome === 'enrolled') {
      result.enrolled++
      continue
    }

    if (attemptResult.outcome === 'unconfirmed') {
      result.unconfirmed++
      continue
    }

    if (attemptResult.outcome === 'run-fatal') {
      result.failed++
      result.aborted = true
      api?.statusPanel.addMessage(
        'error',
        `Neptun reports there is no open course registration period. Stopped after the first subject; the remaining ${eligibleTargets.length - result.attempted} were not clicked. Console run: ${diagnostics.runId}.`,
      )
      break
    }

    if (attemptResult.outcome === 'aborted') {
      result.failed++
      result.aborted = true
      api?.statusPanel.addMessage(
        'error',
        `Neptun opened a registration confirmation. Complete or cancel it manually, enable “do not show again,” then retry. Remaining subjects were not clicked. Console run: ${diagnostics.runId}.`,
      )
      break
    }

    result.failed++
  }

  const summary =
    `Planner enrollment: ${result.enrolled} enrolled, ${result.failed} failed, ` +
    `${result.unconfirmed} unconfirmed, ${result.skipped} skipped.${result.aborted ? ' Stopped safely.' : ''}`
  const summaryWithRunId = `${summary} Console run: ${diagnostics.runId}.`

  diagnostics.log('enroll:complete', {
    enrolled: result.enrolled,
    failed: result.failed,
    unconfirmed: result.unconfirmed,
    skipped: result.skipped,
    aborted: result.aborted,
  })
  api?.logger.info(summary, result)
  api?.statusPanel.addMessage(
    result.failed === 0 && result.unconfirmed === 0 && !result.aborted ? 'info' : 'warn',
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
