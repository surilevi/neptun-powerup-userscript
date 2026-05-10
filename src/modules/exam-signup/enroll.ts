import { delay } from '../../utils/async'
import { getApi, getIsDisposed } from './state'
import { getExamRows, getRowSubjectCode, getSubjectCode, parseExamRow } from './dom'
import { loadPreferences } from './storage'
import type { ExamPreferences, ExamRowInfo } from './state'
import { waitForRequestComplete } from '../../utils/xhr'

interface SavedExamTarget {
  subjectCode: string
  pref: ExamPreferences[string]
  info: ExamRowInfo
}

interface EnrollmentAttemptResult {
  failed: boolean
  submitted: boolean
  shouldStop: boolean
}

function isCurrentEnrollmentRun(apiRef: ReturnType<typeof getApi>): boolean {
  return !getIsDisposed() && getApi() === apiRef
}

function resolveCurrentTargetInfo(target: SavedExamTarget): ExamRowInfo | null {
  for (const row of getExamRows()) {
    const subjectCode = getRowSubjectCode(row)
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
    .filter((text) =>
      text.length > 0 &&
      text.length < 220 &&
      /siker|sikertelen|hiba|nem enged[ée]lyezett|vizsgajelentkez/i.test(text),
    )

  return candidates[0] ?? null
}

function findSavedExamTargets(prefs: ExamPreferences): SavedExamTarget[] {
  const targets: SavedExamTarget[] = []

  for (const row of getExamRows()) {
    const subjectCode = getRowSubjectCode(row)
    if (!subjectCode) continue

    const pref = prefs[subjectCode]
    if (!pref) continue

    const info = parseExamRow(row)
    if (info.date !== pref.date) continue

    targets.push({ subjectCode, pref, info })
  }

  return targets
}

async function submitEnrollmentTarget(target: SavedExamTarget): Promise<EnrollmentAttemptResult> {
  const api = getApi()
  const { subjectCode, pref } = target
  const info = resolveCurrentTargetInfo(target)

  if (!info) {
    api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: live row not found for ${subjectCode} ${pref.date}`)
    api?.statusPanel.addMessage('warn', `${subjectCode}: live exam row not found before clicking.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  if (!info.felvetelBtn) {
    api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: button not found for ${subjectCode} ${pref.date}`)
    api?.statusPanel.addMessage('warn', `${subjectCode}: enrollment button not found.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  if (!info.felvetelBtn.isConnected) {
    api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: button became detached for ${subjectCode} ${pref.date}`)
    api?.statusPanel.addMessage('warn', `${subjectCode}: enrollment button became detached before click.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  if (info.felvetelBtn.disabled || info.felvetelBtn.hasAttribute('disabled')) {
    api?.logger.info(`[exam-enroll-debug] submitEnrollmentTarget: button disabled for ${subjectCode}`)
    api?.statusPanel.addMessage('warn', `${subjectCode}: registration button is disabled.`)
    return { failed: true, submitted: false, shouldStop: false }
  }

  const capacityMatch = /(\d+)\s*\/\s*(\d+)/.exec(info.capacity)
  if (capacityMatch) {
    const current = parseInt(capacityMatch[1], 10)
    const limit = parseInt(capacityMatch[2], 10)
    api?.logger.info(`[exam-enroll-debug] submitEnrollmentTarget: ${subjectCode} capacity ${current}/${limit}`)
    if (current >= limit) {
      api?.statusPanel.addMessage('warn', `${subjectCode}: saved exam is full (${current}/${limit}).`)
      return { failed: true, submitted: false, shouldStop: false }
    }
  }

  api?.logger.info(`[exam-enroll-debug] submitEnrollmentTarget: clicking Felvetel for ${subjectCode} ${pref.date}`)
  api?.statusPanel.addMessage('info', `Auto-enrolling ${subjectCode}: ${pref.date}...`)
  api?.statusPanel.expand()

  const requestStartedAt = performance.now()
  const requestPromise = waitForRequestComplete(
    'ExamRegistration/SignUpForExam',
    30_000,
    requestStartedAt,
  )

  info.felvetelBtn.click()
  await delay(500)

  if (isCurrentEnrollmentRun(api)) {
    const confirmBtn = findConfirmButton()
    if (confirmBtn) {
      api?.logger.info('[exam-enroll-debug] dialog found, confirming')
      confirmBtn.click()

      const closeStart = Date.now()
      while (Date.now() - closeStart < 2000 && isCurrentEnrollmentRun(api)) {
        if (!findConfirmButton()) break
        await delay(100)
      }
    } else {
      api?.logger.info('[exam-enroll-debug] no dialog - enrollment submitted directly')
    }
  }

  if (isCurrentEnrollmentRun(api)) {
    await delay(500)
  }

  if (!isCurrentEnrollmentRun(api)) {
    return { failed: false, submitted: false, shouldStop: true }
  }

  const requestResult = await requestPromise

  if (!isCurrentEnrollmentRun(api)) {
    return { failed: false, submitted: false, shouldStop: true }
  }

  if (!requestResult.completed) {
    api?.logger.warn(`[exam-enroll-debug] submitEnrollmentTarget: no server response for ${subjectCode}`)
    api?.statusPanel.addMessage('warn', `${subjectCode}: no server response after clicking Felvetel.`)
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
  const prefs = await loadPreferences()

  if (Object.keys(prefs).length === 0) {
    api?.logger.info('[exam-enroll-debug] autoEnrollSaved: no saved preferences found')
    api?.statusPanel.addMessage('info', 'No saved exam preferences found.')
    return
  }

  const pageSubjectCode = getSubjectCode()
  const targets = findSavedExamTargets(prefs)
  api?.logger.info(`[exam-enroll-debug] autoEnrollSaved: found ${targets.length} saved targets on the current page`)

  if (targets.length === 0) {
    if (pageSubjectCode && prefs[pageSubjectCode]) {
      api?.logger.warn(`[exam-enroll-debug] autoEnrollSaved: saved exam date "${prefs[pageSubjectCode].date}" not found on current page`)
      api?.statusPanel.addMessage('warn', `Saved exam date "${prefs[pageSubjectCode].date}" not found on this page.`)
    } else {
      api?.logger.info('[exam-enroll-debug] autoEnrollSaved: no saved exam targets visible on this page')
      api?.statusPanel.addMessage('info', 'No saved exam targets are visible on this page.')
    }
    showRetryButton()
    return
  }

  api?.statusPanel.addMessage('info', `Exam Rush: ${targets.length} saved target${targets.length === 1 ? '' : 's'} visible.`)
  api?.statusPanel.setExamRushMode(false)
  api?.statusPanel.addMessage('info', 'Exam Rush triggered and turned off to avoid repeat runs.')

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
    api?.statusPanel.addMessage('info', `Exam Rush submitted ${submittedCount} saved exam${submittedCount === 1 ? '' : 's'}.`)
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
  retryBtn.textContent = 'Retry Auto-Enroll'
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

export function findConfirmButton(): HTMLElement | null {
  const api = getApi()
  const overlay = document.querySelector('.cdk-overlay-container')
  if (!overlay) {
    api?.logger.info('[exam-enroll-debug] findConfirmButton: no overlay container found')
    return null
  }
  const buttons = Array.from(overlay.querySelectorAll('button'))
  api?.logger.info(`[exam-enroll-debug] findConfirmButton: ${buttons.length} buttons in overlay`)
  const btn = buttons.find((b) => {
    const text = (b.textContent ?? '').trim()
    return /meger[oĹ‘]s[iĂ­]t/i.test(text) || text.includes('Igen') || text.includes('OK')
  })
  if (btn) {
    api?.logger.info(`[exam-enroll-debug] findConfirmButton: matched button text="${(btn.textContent ?? '').trim().substring(0, 30)}"`)
  }
  return (btn as HTMLElement) ?? null
}

export async function waitForExamTable(timeoutMs: number): Promise<boolean> {
  const api = getApi()
  const start = Date.now()
  let pollCount = 0
  api?.logger.info(`[exam-enroll-debug] waitForExamTable: starting poll, timeout=${timeoutMs}ms`)
  while (Date.now() - start < timeoutMs) {
    const rowCount = getExamRows().length
    if (rowCount > 0) {
      api?.logger.info(`[exam-enroll-debug] waitForExamTable: found ${rowCount} rows after ${pollCount} polls (${Date.now() - start}ms)`)
      return true
    }
    pollCount++
    await delay(300)
  }
  api?.logger.warn(`[exam-enroll-debug] waitForExamTable: timed out after ${pollCount} polls (${timeoutMs}ms)`)
  return false
}
