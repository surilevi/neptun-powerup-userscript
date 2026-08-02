import { delay } from '../../utils/async'
import {
  getApi,
  getIsDisposed,
  getIsEnrollmentInProgress,
  setIsEnrollmentInProgress,
} from './state'
import {
  buildTableSubjectCodeMap,
  getExamRows,
  getRowSubjectCode,
  getSubjectCode,
  parseExamRow,
} from './dom'
import { loadPreferences } from './storage'
import type { ExamPreferences, ExamRowInfo } from './state'
import { waitForRequestComplete } from '../../utils/xhr'
import { SESSION_STORAGE_KEYS } from '../../types/neptun-api'

interface SavedExamTarget {
  subjectCode: string
  pref: ExamPreferences[string]
}

interface EnrollmentAttemptResult {
  failed: boolean
  submitted: boolean
  shouldStop: boolean
}

const CONFIRM_BUTTON_WAIT_MS = 5000
const CONFIRM_BUTTON_POLL_MS = 50
const EXAM_TABLE_WAIT_POLL_MS = 300
const SAVED_TARGET_WAIT_MS = 15_000
const SAVED_TARGET_POLL_MS = 300

function isCurrentEnrollmentRun(apiRef: ReturnType<typeof getApi>): boolean {
  return !getIsDisposed() && getApi() === apiRef
}

function resolveCurrentTargetInfo(target: SavedExamTarget): ExamRowInfo | null {
  const tableSubjectCodes = buildTableSubjectCodeMap()

  for (const row of getExamRows()) {
    const subjectCode = getRowSubjectCode(row, tableSubjectCodes)
    if (subjectCode !== target.subjectCode) continue

    const info = parseExamRow(row)
    if (info.date !== target.pref.date) continue

    return info
  }

  return null
}

function getLatestNotificationSummary(): string | null {
  const candidates = Array.from(document.querySelectorAll('body *'))
    .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(
      (text) =>
        text.length > 0 &&
        text.length < 220 &&
        /siker|sikertelen|hiba|nem enged[ée]lyezett|vizsgajelentkez/i.test(text),
    )

  return candidates[0] ?? null
}

function findSavedExamTargets(prefs: ExamPreferences): SavedExamTarget[] {
  const targets: SavedExamTarget[] = []
  const tableSubjectCodes = buildTableSubjectCodeMap()

  for (const row of getExamRows()) {
    const subjectCode = getRowSubjectCode(row, tableSubjectCodes)
    if (!subjectCode) continue

    const pref = prefs[subjectCode]
    if (!pref) continue

    if (parseExamRow(row).date !== pref.date) continue

    targets.push({ subjectCode, pref })
  }

  return targets
}

async function waitForSavedExamTargets(
  prefs: ExamPreferences,
  timeoutMs: number = SAVED_TARGET_WAIT_MS,
): Promise<SavedExamTarget[]> {
  const api = getApi()
  const start = Date.now()
  let pollCount = 0

  while (Date.now() - start < timeoutMs) {
    if (getIsDisposed()) return []

    const targets = findSavedExamTargets(prefs)
    if (targets.length > 0) {
      api?.logger.info(
        `[exam-enroll-debug] waitForSavedExamTargets: found ${targets.length} target(s) after ${pollCount} polls (${Date.now() - start}ms)`,
      )
      return targets
    }

    pollCount++
    await delay(SAVED_TARGET_POLL_MS)
  }

  const targets = findSavedExamTargets(prefs)
  if (targets.length > 0) {
    api?.logger.info(
      `[exam-enroll-debug] waitForSavedExamTargets: found ${targets.length} target(s) on final check (${Date.now() - start}ms)`,
    )
    return targets
  }

  api?.logger.info(
    `[exam-enroll-debug] waitForSavedExamTargets: no saved targets after ${pollCount} polls (${timeoutMs}ms)`,
  )
  return []
}

function hasSessionToken(): boolean {
  const api = getApi()

  try {
    const token = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
    if (!token) {
      api?.logger.warn('no access_token in sessionStorage - session may have expired')
      api?.statusPanel.addMessage('error', 'Session expired. Log in again before enrolling.')
      return false
    }
  } catch (err) {
    api?.logger.warn('cannot check sessionStorage for access_token:', err)
  }

  return true
}

function normalizeButtonText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isConfirmButtonText(text: string): boolean {
  const normalized = normalizeButtonText(text)
  return (
    normalized.includes('megerosit') ||
    normalized.includes('confirm') ||
    normalized === 'igen' ||
    normalized === 'ok'
  )
}

function isExamConfirmationDialogText(text: string): boolean {
  const normalized = normalizeButtonText(text)
  const mentionsExam = normalized.includes('vizsga') || normalized.includes('exam')
  const mentionsEnrollment =
    normalized.includes('jelentkez') ||
    normalized.includes('felvetel') ||
    normalized.includes('registration') ||
    normalized.includes('sign up') ||
    normalized.includes('enroll')

  return mentionsExam && mentionsEnrollment
}

function isButtonInteractable(button: HTMLElement): boolean {
  if (!button.isConnected) return false
  if (button.hasAttribute('disabled')) return false

  const htmlButton = button as HTMLButtonElement
  if (typeof htmlButton.disabled === 'boolean' && htmlButton.disabled) return false

  const ariaDisabled = button.getAttribute('aria-disabled')
  if (ariaDisabled === 'true') return false

  const style = window.getComputedStyle(button)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none'
}

function findConfirmButtonElement(): HTMLElement | null {
  const overlays = Array.from(document.querySelectorAll('.cdk-overlay-container'))
  if (overlays.length === 0) return null

  const buttons = overlays.flatMap((overlay) => Array.from(overlay.querySelectorAll('button')))
  const btn = buttons.find((button) => {
    if (!isConfirmButtonText(button.textContent ?? '') || !isButtonInteractable(button)) {
      return false
    }

    const dialogText =
      button.closest('.cdk-overlay-pane, .mat-mdc-dialog-container')?.textContent ??
      button.parentElement?.textContent ??
      ''

    return isExamConfirmationDialogText(dialogText)
  })
  return (btn as HTMLElement) ?? null
}

export function waitForConfirmButton(
  timeoutMs: number = CONFIRM_BUTTON_WAIT_MS,
  stopWhen?: Promise<unknown>,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let settled = false
    let observer: MutationObserver | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    function cleanup(): void {
      observer?.disconnect()
      if (pollTimer) clearInterval(pollTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }

    function settle(button: HTMLElement | null): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(button)
    }

    function check(): void {
      const button = findConfirmButtonElement()
      if (button) settle(button)
    }

    check()
    if (settled) return

    const observerTarget = document.body ?? document.documentElement
    if (observerTarget) {
      observer = new MutationObserver(check)
      observer.observe(observerTarget, { attributes: true, childList: true, subtree: true })
    }

    pollTimer = setInterval(check, CONFIRM_BUTTON_POLL_MS)
    timeoutTimer = setTimeout(() => settle(null), timeoutMs)
    stopWhen?.then(
      () => settle(null),
      () => settle(null),
    )
  })
}

async function submitEnrollmentTarget(target: SavedExamTarget): Promise<EnrollmentAttemptResult> {
  const api = getApi()
  const { subjectCode, pref } = target
  const info = resolveCurrentTargetInfo(target)

  if (!info) {
    api?.logger.warn(
      `[exam-enroll-debug] submitEnrollmentTarget: live row not found for ${subjectCode} ${pref.date}`,
    )
    api?.statusPanel.addMessage('warn', `${subjectCode}: saved exam row is not visible.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  if (!info.felvetelBtn) {
    api?.logger.warn(
      `[exam-enroll-debug] submitEnrollmentTarget: button not found for ${subjectCode} ${pref.date}`,
    )
    api?.statusPanel.addMessage('warn', `${subjectCode}: enrollment button is missing.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  if (!info.felvetelBtn.isConnected) {
    api?.logger.warn(
      `[exam-enroll-debug] submitEnrollmentTarget: button became detached for ${subjectCode} ${pref.date}`,
    )
    api?.statusPanel.addMessage('warn', `${subjectCode}: enrollment button changed before click.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  if (info.felvetelBtn.disabled || info.felvetelBtn.hasAttribute('disabled')) {
    api?.logger.info(
      `[exam-enroll-debug] submitEnrollmentTarget: button disabled for ${subjectCode}`,
    )
    api?.statusPanel.addMessage('warn', `${subjectCode}: registration button is disabled.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  const capacityMatch = /(\d+)\s*\/\s*(\d+)/.exec(info.capacity)
  if (capacityMatch) {
    const current = parseInt(capacityMatch[1], 10)
    const limit = parseInt(capacityMatch[2], 10)
    api?.logger.info(
      `[exam-enroll-debug] submitEnrollmentTarget: ${subjectCode} capacity ${current}/${limit}`,
    )
    if (current >= limit) {
      api?.statusPanel.addMessage(
        'warn',
        `${subjectCode}: saved exam is full (${current}/${limit}).`,
      )
      return { failed: true, submitted: false, shouldStop: false }
    }
  }

  api?.logger.info(
    `[exam-enroll-debug] submitEnrollmentTarget: clicking Felvétel for ${subjectCode} ${pref.date}`,
  )
  api?.statusPanel.addMessage('info', `Auto-enrolling ${subjectCode}: ${pref.date}...`)
  api?.statusPanel.expand()

  const requestStartedAt = performance.now()
  const requestPromise = waitForRequestComplete(
    'ExamRegistration/SignUpForExam',
    30_000,
    requestStartedAt,
  )

  info.felvetelBtn.click()

  if (isCurrentEnrollmentRun(api)) {
    const confirmBtn = await waitForConfirmButton(CONFIRM_BUTTON_WAIT_MS, requestPromise)
    if (confirmBtn) {
      api?.logger.info('[exam-enroll-debug] dialog found, confirming')
      confirmBtn.click()
    } else {
      api?.logger.info(
        '[exam-enroll-debug] no dialog - enrollment submitted directly or confirmation did not appear',
      )
    }
  }

  if (!isCurrentEnrollmentRun(api)) {
    return { failed: false, submitted: false, shouldStop: true }
  }

  const requestResult = await requestPromise

  if (!isCurrentEnrollmentRun(api)) {
    return { failed: false, submitted: false, shouldStop: true }
  }

  if (!requestResult.completed) {
    api?.logger.warn(
      `[exam-enroll-debug] submitEnrollmentTarget: no server response for ${subjectCode}`,
    )
    api?.statusPanel.addMessage(
      'warn',
      `${subjectCode}: no server response after clicking Felvétel.`,
    )
    return { failed: true, submitted: false, shouldStop: false }
  }

  if (requestResult.status !== null && requestResult.status >= 400) {
    const notificationSummary = getLatestNotificationSummary()
    api?.logger.warn(
      `[exam-enroll-debug] submitEnrollmentTarget: request failed for ${subjectCode} with status=${requestResult.status}`,
    )
    api?.statusPanel.addMessage(
      'warn',
      notificationSummary
        ? `${subjectCode}: ${notificationSummary}`
        : `${subjectCode}: server returned ${requestResult.status}.`,
    )
    return { failed: true, submitted: false, shouldStop: false }
  }

  api?.statusPanel.addMessage('info', `Enrollment submitted for ${subjectCode}: ${pref.date}.`)
  return { failed: false, submitted: true, shouldStop: false }
}

export async function autoEnrollSaved(): Promise<void> {
  const api = getApi()
  if (getIsEnrollmentInProgress()) {
    api?.logger.warn('[exam-enroll-debug] autoEnrollSaved: enrollment already in progress')
    return
  }

  if (!hasSessionToken()) return

  setIsEnrollmentInProgress(true)

  try {
    const prefs = await loadPreferences()

    if (Object.keys(prefs).length === 0) {
      api?.logger.info('[exam-enroll-debug] autoEnrollSaved: no saved preferences found')
      api?.statusPanel.addMessage('info', 'No saved exam dates found.')
      return
    }

    const pageSubjectCode = getSubjectCode()
    let targets = findSavedExamTargets(prefs)
    api?.logger.info(
      `[exam-enroll-debug] autoEnrollSaved: found ${targets.length} saved targets on the current page`,
    )

    const mayStillRenderSavedTarget =
      Object.keys(prefs).length > 0 && (pageSubjectCode === null || Boolean(prefs[pageSubjectCode]))

    if (targets.length === 0 && mayStillRenderSavedTarget) {
      api?.statusPanel.addMessage('info', 'Waiting for saved exam rows to finish loading...')
      targets = await waitForSavedExamTargets(prefs)
      if (!isCurrentEnrollmentRun(api)) return
    }

    if (targets.length === 0) {
      if (pageSubjectCode && prefs[pageSubjectCode]) {
        api?.logger.warn(
          `[exam-enroll-debug] autoEnrollSaved: saved exam date "${prefs[pageSubjectCode].date}" not found on current page`,
        )
        api?.statusPanel.addMessage(
          'warn',
          `Saved exam date "${prefs[pageSubjectCode].date}" not found on this page.`,
        )
      } else {
        api?.logger.info(
          '[exam-enroll-debug] autoEnrollSaved: no saved exam targets visible on this page',
        )
        api?.statusPanel.addMessage('info', 'No saved exam dates are visible on this page.')
      }
      showRetryButton()
      return
    }

    api?.statusPanel.addMessage(
      'info',
      `Exam Rush: ${targets.length} saved target${targets.length === 1 ? '' : 's'} visible.`,
    )
    // Disarm durably *before* acting, so a reload mid-run cannot start a second rush.
    await api?.statusPanel.setExamRushMode(false)
    api?.statusPanel.addMessage('info', 'Exam Rush started and turned itself off.')

    let failedCount = 0
    let submittedCount = 0
    let stoppedEarly = false
    for (const target of targets) {
      if (!isCurrentEnrollmentRun(api)) {
        break
      }

      const result = await submitEnrollmentTarget(target)
      if (result.submitted) {
        submittedCount++
        await delay(250)
      }
      if (result.failed) {
        failedCount++
        await delay(250)
      }

      if (result.shouldStop) {
        stoppedEarly = true
        break
      }
    }

    if (!isCurrentEnrollmentRun(api)) {
      return
    }

    if (submittedCount === 0 && failedCount === 0) {
      api?.statusPanel.addMessage('warn', 'Exam Rush did not submit any visible saved exams.')
      showRetryButton()
    } else if (stoppedEarly) {
      api?.statusPanel.addMessage(
        'warn',
        `Exam Rush stopped early: ${submittedCount} submitted, ${failedCount} failed.`,
      )
    } else if (failedCount > 0) {
      api?.statusPanel.addMessage(
        'warn',
        `Exam Rush finished: ${submittedCount} submitted, ${failedCount} failed.`,
      )
    } else {
      api?.statusPanel.addMessage(
        'info',
        `Exam Rush submitted ${submittedCount} saved exam${submittedCount === 1 ? '' : 's'}.`,
      )
    }
  } finally {
    setIsEnrollmentInProgress(false)
  }
}

export function showRetryButton(): void {
  const api = getApi()
  if (!api) return
  document.querySelector('.npu-exam-retry-btn')?.remove()

  const retryBtn = document.createElement('button')
  retryBtn.className = 'npu-exam-retry-btn'
  retryBtn.style.cssText =
    'padding: 4px 12px; background: #e65100; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; font-weight: bold; margin-top: 4px; display: block;'
  retryBtn.textContent = 'Retry Enrollment'
  retryBtn.addEventListener('click', () => {
    retryBtn.remove()
    autoEnrollSaved().catch((err) => api?.logger.error('retry auto-enroll failed:', err))
  })

  document.body.appendChild(retryBtn)
  retryBtn.style.position = 'fixed'
  retryBtn.style.bottom = '60px'
  retryBtn.style.right = '20px'
  retryBtn.style.zIndex = '99998'
}

export async function waitForExamTable(timeoutMs: number): Promise<boolean> {
  const api = getApi()
  const start = Date.now()
  let pollCount = 0
  let observer: MutationObserver | null = null
  let mutationCount = 0

  function hasRows(): boolean {
    return getExamRows().length > 0
  }

  api?.logger.info(`[exam-enroll-debug] waitForExamTable: starting poll, timeout=${timeoutMs}ms`)

  const observerTarget = document.querySelector('main') ?? document.body ?? document.documentElement
  if (observerTarget) {
    try {
      observer = new MutationObserver((mutations) => {
        mutationCount += mutations.length
      })
      observer.observe(observerTarget, { childList: true, subtree: true })
    } catch (err) {
      api?.logger.warn('[exam-enroll-debug] waitForExamTable: failed to observe DOM changes', err)
    }
  }

  while (Date.now() - start < timeoutMs) {
    if (hasRows()) {
      const rowCount = getExamRows().length
      observer?.disconnect()
      api?.logger.info(
        `[exam-enroll-debug] waitForExamTable: found ${rowCount} rows after ${pollCount} polls (${Date.now() - start}ms, mutations=${mutationCount})`,
      )
      return true
    }
    pollCount++
    await delay(EXAM_TABLE_WAIT_POLL_MS)
  }

  if (hasRows()) {
    const rowCount = getExamRows().length
    observer?.disconnect()
    api?.logger.info(
      `[exam-enroll-debug] waitForExamTable: found ${rowCount} rows on final check (${Date.now() - start}ms, mutations=${mutationCount})`,
    )
    return true
  }

  observer?.disconnect()
  api?.logger.warn(
    `[exam-enroll-debug] waitForExamTable: timed out after ${pollCount} polls (${timeoutMs}ms, mutations=${mutationCount})`,
  )
  return false
}
