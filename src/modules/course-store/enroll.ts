import { delay } from '../../utils/async'
import { SESSION_STORAGE_KEYS } from '../../types/neptun-api'
import { getApi, getIsEnrolling, setIsEnrolling } from './state'
import {
  getSubjectPanels,
  isPanelExpanded,
  getCourseItems,
  isCourseSelected,
  extractSubjectCode,
  isEnrollButtonText,
} from './dom'
import { loadSelections } from './storage'
import { loadStoredSelections } from './load'
import { waitForRequestComplete } from '../../utils/xhr'

/**
 * Check if the access token is about to expire (<30s remaining).
 * If so, trigger a lightweight API request to force Angular's token refresh
 * interceptor, then wait briefly for the new token to arrive.
 */
async function ensureTokenFresh(): Promise<void> {
  const api = getApi()
  try {
    const token = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
    if (!token) return
    const parts = token.split('.')
    if (parts.length !== 3) return
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    const expiresAt = payload.exp * 1000
    const remaining = expiresAt - Date.now()
    api?.logger.info(`[enroll-debug] ensureTokenFresh: remaining=${Math.round(remaining / 1000)}s`)
    if (remaining < 30000) {
      api?.logger.info(
        '[enroll-debug] ensureTokenFresh: token expiring soon, triggering refresh...',
      )
      const pathPrefix = window.location.pathname.split('/')[1] || 'hallgatoi'
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      try {
        await fetch(`/${pathPrefix}/api/Message/GetUnreadedMessagesCount`, {
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
      await delay(2000)
      api?.logger.info('[enroll-debug] ensureTokenFresh: refresh triggered, continuing')
    }
  } catch {
    // Non-critical - proceed with enrollment anyway
  }
}

export async function quickEnrollAll(): Promise<void> {
  const api = getApi()

  if (getIsEnrolling()) {
    api?.logger.warn('enrollment already in progress')
    return
  }
  setIsEnrolling(true)

  try {
    // Check if session is still valid
    try {
      const token = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
      if (!token) {
        api?.logger.warn('no access_token in sessionStorage - session may have expired')
        api?.statusPanel.addMessage('error', 'Session expired. Log in again before enrolling.')
        return
      }
    } catch (err) {
      api?.logger.warn('cannot check sessionStorage for access_token:', err)
    }

    const panels = getSubjectPanels()
    const enrollable = panels.filter((panel) => {
      if (!isPanelExpanded(panel)) return false
      const items = getCourseItems(panel)
      return items.some((item) => isCourseSelected(item))
    })

    if (enrollable.length === 0) {
      const msg =
        panels.length === 0
          ? 'No subjects are listed. Search first, then load your saved courses.'
          : 'No courses are selected. Load saved courses first, or select them manually.'
      api?.logger.warn(msg)
      api?.statusPanel.addMessage('warn', msg)
      return
    }

    // Check token freshness once before the batch
    await ensureTokenFresh()

    api?.statusPanel.addMessage(
      'info',
      `Enrolling ${enrollable.length} subject${enrollable.length === 1 ? '' : 's'}...`,
    )

    let enrolled = 0
    let failed = 0
    const errors: string[] = []

    for (const panel of enrollable) {
      const code = extractSubjectCode(panel) ?? '???'
      api?.logger.info(
        `[enroll-debug] enrolling ${code} (${enrolled + failed + 1}/${enrollable.length})`,
      )
      api?.statusPanel.addMessage(
        'info',
        `Enrolling ${code}... (${enrolled + failed + 1}/${enrollable.length})`,
      )

      const enrollStartedAt = performance.now()
      if (!enrollSubject(panel, code)) {
        failed++
        errors.push(`${code}: enroll button not found`)
        continue
      }

      // Wait for Angular's enrollment POST to complete.
      // Uses PerformanceObserver (browser-level API) because Tampermonkey's
      // sandbox prevents XHR prototype patching from intercepting page requests.
      const requestResult = await waitForRequestComplete(
        'SubjectApplication/SubjectSignin',
        30_000,
        enrollStartedAt,
      )

      if (!requestResult.completed) {
        failed++
        errors.push(`${code}: timed out waiting for server response`)
        api?.logger.warn(`[enroll-debug] ${code}: no response within 30s`)
        continue
      }

      if (requestResult.status !== null && requestResult.status >= 400) {
        failed++
        errors.push(`${code}: server returned ${requestResult.status}`)
        api?.logger.warn(
          `[enroll-debug] ${code}: enrollment request completed with status=${requestResult.status}`,
        )
        continue
      }

      enrolled++
      if (requestResult.status === null) {
        api?.logger.info(
          `[enroll-debug] ${code}: enrollment request completed (status unavailable)`,
        )
      } else {
        api?.logger.info(
          `[enroll-debug] ${code}: enrollment request completed with status=${requestResult.status}`,
        )
      }
    }

    let summary = `Done: ${enrolled} enrolled, ${failed} failed.`
    if (errors.length > 0) {
      summary += ` Errors: ${errors.join('; ')}`
    }
    api?.logger.info(summary)
    api?.statusPanel.addMessage(enrolled > 0 && failed === 0 ? 'info' : 'warn', summary)
  } finally {
    setIsEnrolling(false)
  }
}

/**
 * LOAD & ENROLL: The one-click registration rush button.
 */
let isLoadAndEnrolling = false

export async function loadAndEnroll(): Promise<void> {
  const api = getApi()

  if (getIsEnrolling() || isLoadAndEnrolling) {
    api?.logger.warn('enrollment already in progress')
    return
  }
  isLoadAndEnrolling = true

  try {
    const selections = await loadSelections()
    if (Object.keys(selections).length === 0) {
      api?.statusPanel.addMessage('warn', 'No saved course selections. Save courses first.')
      return
    }

    api?.statusPanel.addMessage('info', 'Loading saved courses...')
    api?.statusPanel.expand()
    await loadStoredSelections()

    api?.statusPanel.addMessage('info', 'Saved courses loaded. Starting enrollment...')
    await quickEnrollAll()
  } finally {
    isLoadAndEnrolling = false
  }
}

/**
 * Click the enrollment button for a single subject panel.
 * Result checking is handled centrally via notification polling.
 * Returns true if the button was found and clicked, false otherwise.
 */
export function enrollSubject(panel: Element, subjectCode: string): boolean {
  const api = getApi()

  const buttons = Array.from(panel.querySelectorAll('button'))
  const enrollBtn = buttons.find((btn) => isEnrollButtonText(btn.textContent ?? ''))

  if (!enrollBtn) {
    api?.logger.warn(`enroll button not found for ${subjectCode}`)
    return false
  }

  enrollBtn.click()
  api?.logger.info(`[enroll-debug] clicked enroll for ${subjectCode}`)
  return true
}
