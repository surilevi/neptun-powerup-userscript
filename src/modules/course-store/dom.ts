import { delay } from '../../utils/async'
import { KNOWN_ENDPOINTS } from '../../types/neptun-api'
import { waitForRequestComplete, type RequestCompletionResult } from '../../utils/xhr'
import { extractSubjectCodeFromText, isLikelySubjectCode } from '../../utils/subject-code'
import { getApi } from './state'
import { waitForElement } from './helpers'

const AUTO_SEARCH_TIMEOUT_MS = 20_000
const AUTO_SEARCH_POLL_MS = 250
const AUTO_SEARCH_STABLE_MS = 500
const SEARCH_RESULT_SETTLE_GRACE_MS = 2_000

function normalizeButtonText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const SEARCH_BUTTON_PATTERNS = ['targy keres', 'search subject', 'subject search']

const ENROLL_BUTTON_PATTERNS = ['targy felvetele', 'take subject', 'enroll subject']

function sanitizeText(text: string, maxLen: number = 60): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

function normalizeCourseCode(code: string): string {
  return code.replace(/\s+/g, '').trim().toUpperCase()
}

const COURSE_CODE_STOP_WORDS = [
  'ELOADAS',
  'GYAKORLAT',
  'JELENLETI',
  'KREDIT',
  'KURZUS',
  'LABOR',
  'LIMIT',
  'MINIMALIS',
  'TIPUS',
]

function isCourseCodeToken(
  token: string,
  { allowShortAlpha = false }: { allowShortAlpha?: boolean } = {},
): boolean {
  const normalized = normalizeCourseCode(token)
  const minLength = allowShortAlpha ? 1 : 2
  if (normalized.length < minLength || normalized.length > 20) return false
  if (isLikelySubjectCode(normalized)) return false
  if (!/^[A-Z0-9][A-Z0-9_.-]*$/.test(normalized)) return false
  if (COURSE_CODE_STOP_WORDS.some((word) => normalized.startsWith(word))) {
    return false
  }

  if (allowShortAlpha && /^[A-Z]{1,4}$/.test(normalized)) {
    return true
  }

  // Real Neptun course codes are short identifiers such as AE1, NE1, or 2xx_A1N.
  // This keeps status/type words from being treated as course codes.
  return /[A-Z]/.test(normalized) && /[0-9_]/.test(normalized)
}

function extractCourseCodeFromText(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null

  const exact = normalizeCourseCode(trimmed)
  if (isCourseCodeToken(exact)) return exact

  const underscored = /[A-Z0-9]{1,10}_[A-Z0-9]{1,10}/i.exec(trimmed)
  if (underscored && isCourseCodeToken(underscored[0])) {
    return normalizeCourseCode(underscored[0])
  }

  const boundedTokens = trimmed.match(/\b[A-Z0-9][A-Z0-9_.-]{1,19}\b/gi) ?? []
  for (const token of boundedTokens) {
    if (isCourseCodeToken(token)) return normalizeCourseCode(token)
  }

  return null
}

function extractCourseCodeFromExactCandidate(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null

  const exact = normalizeCourseCode(trimmed)
  if (isCourseCodeToken(exact, { allowShortAlpha: true })) {
    return exact
  }

  return null
}

function getTextNodeCandidates(root: Element): string[] {
  const candidates: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = node.textContent?.replace(/\s+/g, ' ').trim()
    if (!text) continue

    const parent = node.parentElement
    if (parent?.closest('button, mat-icon, .mat-icon, mat-chip, .mat-chip, .mat-mdc-chip')) {
      continue
    }

    candidates.push(text)
  }

  return candidates
}

function isSearchButtonText(text: string): boolean {
  const normalized = normalizeButtonText(text)
  return SEARCH_BUTTON_PATTERNS.some((pattern) => normalized.includes(pattern))
}

export function isEnrollButtonText(text: string): boolean {
  const normalized = normalizeButtonText(text)
  return ENROLL_BUTTON_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function findSearchButton(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll('button'))
  const match = buttons.find((btn) => isSearchButtonText(btn.textContent ?? ''))
  return (match as HTMLElement) ?? null
}

function isButtonInteractable(button: HTMLElement): boolean {
  if (!button.isConnected) return false
  if (button.hasAttribute('disabled')) return false

  const htmlButton = button as HTMLButtonElement
  if (typeof htmlButton.disabled === 'boolean' && htmlButton.disabled) return false

  const ariaDisabled = button.getAttribute('aria-disabled')
  if (ariaDisabled === 'true') return false

  const style = window.getComputedStyle(button)
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
    return false
  }

  return true
}

function describeButton(button: HTMLElement | null): Record<string, unknown> | null {
  if (!button) return null

  return {
    text: sanitizeText(button.textContent ?? ''),
    disabled: button.hasAttribute('disabled') || (button as HTMLButtonElement).disabled,
    ariaDisabled: button.getAttribute('aria-disabled'),
    connected: button.isConnected,
    className: button.className,
  }
}

function getAutoSearchSnapshot(): Record<string, unknown> {
  const buttons = Array.from(document.querySelectorAll('button'))
  const buttonTexts = buttons
    .map((btn) => sanitizeText(btn.textContent ?? ''))
    .filter((text) => text.length > 0)

  return {
    readyState: document.readyState,
    path: window.location.pathname,
    panels: getSubjectPanels().length,
    buttons: buttons.length,
    searchCandidates: buttonTexts.filter((text) => isSearchButtonText(text)),
    sampleButtons: buttonTexts.slice(0, 8),
  }
}

export interface AutoSearchSubjectsResult {
  clickedSearchButton: boolean
  searchStartedAtMs: number | null
}

export interface SubjectListingWaitResult {
  state: 'panels-loaded' | 'request-completed-no-panels' | 'request-failed' | 'timed-out'
  panels: number
  requestStatus: number | null
}

export interface SubjectListingWaitOptions {
  timeoutMs?: number
  searchStartedAtMs?: number
  allowAutoClick?: boolean
}

function describeRequestResult(result: RequestCompletionResult | null): Record<string, unknown> {
  if (!result) {
    return {
      completed: false,
      status: null,
    }
  }

  return {
    completed: result.completed,
    status: result.status,
  }
}

/**
 * Extract the subject code from an expansion panel header.
 * Different universities use different prefixes, so we avoid hardcoding BME.
 */
export function extractSubjectCode(panel: Element): string | null {
  const api = getApi()
  const headerText =
    panel.querySelector('mat-expansion-panel-header')?.textContent ??
    panel.querySelector('.mat-expansion-panel-header')?.textContent ??
    panel.textContent ??
    ''
  const code = extractSubjectCodeFromText(headerText)
  if (!code) {
    api?.logger.info(
      `[dom-debug] extractSubjectCode: no code found, header starts with "${headerText.substring(0, 50)}"`,
    )
  }
  return code
}

/**
 * Extract the course code (for example "AE1" or "NE1") from a course row.
 * Prefer narrow label/text-node sources because Angular Material may concatenate
 * status text, labels, and chip text in courseItem.textContent.
 */
export function extractCourseCode(courseItem: Element): string | null {
  const api = getApi()
  const text = (courseItem.textContent ?? '').trim()

  const selectors = [
    '.mat-mdc-checkbox .mdc-label',
    '.mat-checkbox-label',
    'mat-checkbox label',
    '.mat-mdc-checkbox label',
    '[data-course-code]',
    '[aria-label]',
    '[title]',
  ]

  for (const selector of selectors) {
    const elements = Array.from(courseItem.querySelectorAll(selector))
    for (const element of elements) {
      const values = [
        element.textContent ?? '',
        element.getAttribute('data-course-code') ?? '',
        element.getAttribute('aria-label') ?? '',
        element.getAttribute('title') ?? '',
      ]

      for (const value of values) {
        const code = extractCourseCodeFromExactCandidate(value) ?? extractCourseCodeFromText(value)
        if (code) {
          api?.logger.info(
            `[dom-debug] extractCourseCode: selector "${selector}" matched="${code}"`,
          )
          return code
        }
      }
    }
  }

  for (const candidate of getTextNodeCandidates(courseItem)) {
    const code =
      extractCourseCodeFromExactCandidate(candidate) ?? extractCourseCodeFromText(candidate)
    if (code) {
      api?.logger.info(`[dom-debug] extractCourseCode: text node matched="${code}"`)
      return code
    }
  }

  const beforeType = /(?:^|[\s:])([A-Z0-9][A-Z0-9_.-]{1,19})(?=\s*T(?:i|í)pus)/i.exec(text)
  if (beforeType && isCourseCodeToken(beforeType[1])) {
    const code = normalizeCourseCode(beforeType[1])
    api?.logger.info(`[dom-debug] extractCourseCode: before type label matched="${code}"`)
    return code
  }

  const afterCourseCodeLabel = /Kurzus\s*k(?:o|ó)d\s*:?\s*([A-Z0-9][A-Z0-9_.-]{1,19})/i.exec(text)
  if (afterCourseCodeLabel && isCourseCodeToken(afterCourseCodeLabel[1])) {
    const code = normalizeCourseCode(afterCourseCodeLabel[1])
    api?.logger.info(`[dom-debug] extractCourseCode: after course-code label matched="${code}"`)
    return code
  }

  api?.logger.warn(
    `[dom-debug] extractCourseCode: no course code found, text starts with "${text.substring(0, 50)}"`,
  )
  return null
}

/**
 * Get all expansion panels on the page (the subject cards).
 */
export function getSubjectPanels(): Element[] {
  return Array.from(document.querySelectorAll('mat-expansion-panel'))
}

export function findSubjectPanel(subjectCode: string): Element | null {
  return getSubjectPanels().find((panel) => extractSubjectCode(panel) === subjectCode) ?? null
}

/**
 * Auto-click the subject search button if no subjects are listed yet.
 * This path needs to survive slow Angular boot and delayed DOM rendering.
 */
export async function autoSearchSubjects(): Promise<AutoSearchSubjectsResult> {
  const api = getApi()
  const start = Date.now()

  const existingPanels = getSubjectPanels().length
  api?.logger.info('[dom-debug] autoSearchSubjects: starting', {
    ...getAutoSearchSnapshot(),
    timeoutMs: AUTO_SEARCH_TIMEOUT_MS,
  })

  if (existingPanels > 0) {
    api?.logger.info(
      `[dom-debug] autoSearchSubjects: skipping, ${existingPanels} subjects already listed`,
    )
    return {
      clickedSearchButton: false,
      searchStartedAtMs: null,
    }
  }

  api?.logger.info(
    '[dom-debug] autoSearchSubjects: no subjects listed, waiting for search button...',
  )

  const observerTarget = document.body ?? document.documentElement
  let mutationCount = 0
  let lastMutationAt = Date.now()
  let lastButtonCount = document.querySelectorAll('button').length
  let lastPanelCount = existingPanels
  let lastCandidateState = ''

  const observer = observerTarget
    ? new MutationObserver((mutations) => {
        mutationCount += mutations.length
        lastMutationAt = Date.now()

        const buttonCount = document.querySelectorAll('button').length
        const panelCount = getSubjectPanels().length
        if (buttonCount !== lastButtonCount || panelCount !== lastPanelCount) {
          lastButtonCount = buttonCount
          lastPanelCount = panelCount
          api?.logger.info('[dom-debug] autoSearchSubjects: DOM changed while waiting', {
            elapsedMs: Date.now() - start,
            readyState: document.readyState,
            panels: panelCount,
            buttons: buttonCount,
          })
        }
      })
    : null

  try {
    observer?.observe(observerTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  } catch (err) {
    api?.logger.warn('[dom-debug] autoSearchSubjects: failed to observe DOM changes', err)
  }

  while (Date.now() - start < AUTO_SEARCH_TIMEOUT_MS) {
    const panels = getSubjectPanels().length
    if (panels > 0) {
      observer?.disconnect()
      api?.logger.info(
        '[dom-debug] autoSearchSubjects: subjects appeared before auto-click was needed',
        {
          elapsedMs: Date.now() - start,
          panels,
          mutations: mutationCount,
        },
      )
      return {
        clickedSearchButton: false,
        searchStartedAtMs: null,
      }
    }

    const searchBtn = findSearchButton()
    if (searchBtn) {
      const interactable = isButtonInteractable(searchBtn)
      const candidateState = JSON.stringify({
        ...describeButton(searchBtn),
        interactable,
      })

      if (candidateState !== lastCandidateState) {
        lastCandidateState = candidateState
        api?.logger.info('[dom-debug] autoSearchSubjects: found search button candidate', {
          elapsedMs: Date.now() - start,
          ...describeButton(searchBtn),
          interactable,
        })
      }

      if (interactable) {
        const idleMs = Date.now() - lastMutationAt
        if (idleMs >= AUTO_SEARCH_STABLE_MS) {
          const searchStartedAtMs = performance.now()
          searchBtn.click()
          observer?.disconnect()
          api?.logger.info('[dom-debug] autoSearchSubjects: auto-clicked search button', {
            elapsedMs: Date.now() - start,
            idleMs,
            mutations: mutationCount,
            button: describeButton(searchBtn),
          })
          return {
            clickedSearchButton: true,
            searchStartedAtMs,
          }
        }
      }
    }

    await delay(AUTO_SEARCH_POLL_MS)
  }

  observer?.disconnect()
  api?.logger.warn(
    `[dom-debug] autoSearchSubjects: search button not found within ${AUTO_SEARCH_TIMEOUT_MS}ms`,
    {
      elapsedMs: Date.now() - start,
      mutations: mutationCount,
      snapshot: getAutoSearchSnapshot(),
    },
  )
  return {
    clickedSearchButton: false,
    searchStartedAtMs: null,
  }
}

export async function waitForSubjectListing({
  timeoutMs = 60_000,
  searchStartedAtMs = performance.now(),
  allowAutoClick = false,
}: SubjectListingWaitOptions = {}): Promise<SubjectListingWaitResult> {
  const api = getApi()
  const start = Date.now()
  const initialPanels = getSubjectPanels().length

  if (initialPanels > 0) {
    api?.logger.info('[dom-debug] waitForSubjectListing: subjects already listed', {
      panels: initialPanels,
    })
    return {
      state: 'panels-loaded',
      panels: initialPanels,
      requestStatus: null,
    }
  }

  api?.logger.info('[dom-debug] waitForSubjectListing: waiting for subject search result', {
    timeoutMs,
    searchStartedAtMs,
    allowAutoClick,
    snapshot: getAutoSearchSnapshot(),
  })

  const requestPromise = waitForRequestComplete(
    KNOWN_ENDPOINTS.schedulableSubjects,
    timeoutMs,
    searchStartedAtMs,
  )
  const requestTracker: { current: RequestCompletionResult | null; completedAtMs: number | null } =
    {
      current: null,
      completedAtMs: null,
    }
  requestPromise
    .then((result) => {
      requestTracker.current = result
      requestTracker.completedAtMs = Date.now()
    })
    .catch((err) => {
      api?.logger.warn('[dom-debug] waitForSubjectListing: request observer failed', err)
    })

  const observerTarget = document.body ?? document.documentElement
  let mutationCount = 0
  let lastMutationAt = Date.now()
  let lastPanelCount = initialPanels
  let lastCandidateState = ''
  let delayedAutoClickTriggered = false

  const observer = observerTarget
    ? new MutationObserver((mutations) => {
        mutationCount += mutations.length
        lastMutationAt = Date.now()

        const panelCount = getSubjectPanels().length
        if (panelCount !== lastPanelCount) {
          lastPanelCount = panelCount
          api?.logger.info('[dom-debug] waitForSubjectListing: panel count changed', {
            elapsedMs: Date.now() - start,
            panels: panelCount,
          })
        }
      })
    : null

  try {
    observer?.observe(observerTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  } catch (err) {
    api?.logger.warn('[dom-debug] waitForSubjectListing: failed to observe DOM changes', err)
  }

  while (Date.now() - start < timeoutMs) {
    const panels = getSubjectPanels().length
    if (panels > 0) {
      observer?.disconnect()
      const requestStatus = requestTracker.current ? requestTracker.current.status : null
      api?.logger.info('[dom-debug] waitForSubjectListing: subjects loaded', {
        elapsedMs: Date.now() - start,
        panels,
        mutations: mutationCount,
        request: describeRequestResult(requestTracker.current),
      })
      return {
        state: 'panels-loaded',
        panels,
        requestStatus,
      }
    }

    const idleMs = Date.now() - lastMutationAt
    const searchBtn = findSearchButton()
    if (searchBtn) {
      const interactable = isButtonInteractable(searchBtn)
      const candidateState = JSON.stringify({
        ...describeButton(searchBtn),
        interactable,
      })

      if (candidateState !== lastCandidateState) {
        lastCandidateState = candidateState
        api?.logger.info('[dom-debug] waitForSubjectListing: observed search button candidate', {
          elapsedMs: Date.now() - start,
          ...describeButton(searchBtn),
          interactable,
        })
      }

      if (
        allowAutoClick &&
        !delayedAutoClickTriggered &&
        interactable &&
        idleMs >= AUTO_SEARCH_STABLE_MS
      ) {
        delayedAutoClickTriggered = true
        searchBtn.click()
        api?.logger.info('[dom-debug] waitForSubjectListing: auto-clicked delayed search button', {
          elapsedMs: Date.now() - start,
          idleMs,
          mutations: mutationCount,
          button: describeButton(searchBtn),
        })
        await delay(AUTO_SEARCH_POLL_MS)
        continue
      }
    }

    const settledRequest = requestTracker.current
    const requestSettledForMs =
      requestTracker.completedAtMs === null ? 0 : Date.now() - requestTracker.completedAtMs
    if (settledRequest !== null && settledRequest.completed) {
      if (
        settledRequest.status !== null &&
        settledRequest.status >= 400 &&
        idleMs >= AUTO_SEARCH_STABLE_MS &&
        requestSettledForMs >= SEARCH_RESULT_SETTLE_GRACE_MS
      ) {
        observer?.disconnect()
        api?.logger.warn('[dom-debug] waitForSubjectListing: subject search request failed', {
          elapsedMs: Date.now() - start,
          idleMs,
          requestSettledForMs,
          mutations: mutationCount,
          status: settledRequest.status,
        })
        return {
          state: 'request-failed',
          panels: 0,
          requestStatus: settledRequest.status,
        }
      }

      const interactable = searchBtn ? isButtonInteractable(searchBtn) : false
      if (
        idleMs >= AUTO_SEARCH_STABLE_MS &&
        requestSettledForMs >= SEARCH_RESULT_SETTLE_GRACE_MS &&
        (interactable || searchBtn === null)
      ) {
        observer?.disconnect()
        api?.logger.info(
          '[dom-debug] waitForSubjectListing: search settled without subject panels',
          {
            elapsedMs: Date.now() - start,
            idleMs,
            requestSettledForMs,
            mutations: mutationCount,
            request: describeRequestResult(requestTracker.current),
            button: describeButton(searchBtn),
          },
        )
        return {
          state: 'request-completed-no-panels',
          panels: 0,
          requestStatus: settledRequest.status,
        }
      }
    }

    await delay(AUTO_SEARCH_POLL_MS)
  }

  observer?.disconnect()
  api?.logger.warn('[dom-debug] waitForSubjectListing: timed out waiting for subject listing', {
    elapsedMs: Date.now() - start,
    mutations: mutationCount,
    request: describeRequestResult(requestTracker.current),
    snapshot: getAutoSearchSnapshot(),
  })
  const requestStatus = requestTracker.current ? requestTracker.current.status : null
  return {
    state: 'timed-out',
    panels: getSubjectPanels().length,
    requestStatus,
  }
}

/**
 * Check whether a panel is currently expanded.
 * Uses multiple detection strategies because Angular Material classes vary.
 */
export function isPanelExpanded(panel: Element): boolean {
  if (panel.classList.contains('mat-expanded')) return true
  if (panel.getAttribute('ng-reflect-expanded') === 'true') return true
  if (panel.querySelectorAll('.course-list-item-container').length > 0) return true
  if (panel.querySelector('.mat-expansion-panel-content[style*="visibility: visible"]') !== null)
    return true
  const header = panel.querySelector('mat-expansion-panel-header')
  if (header?.getAttribute('aria-expanded') === 'true') return true
  return false
}

/**
 * Click the panel header to expand it, then wait for the course list to render.
 */
export async function expandPanel(panel: Element): Promise<boolean> {
  const api = getApi()
  if (isPanelExpanded(panel)) {
    api?.logger.info('[dom-debug] expandPanel: panel already expanded')
    return true
  }

  const header = panel.querySelector('mat-expansion-panel-header')
  if (!header) {
    api?.logger.warn('[dom-debug] expandPanel: mat-expansion-panel-header not found')
    return false
  }

  ;(header as HTMLElement).click()
  api?.logger.info('[dom-debug] expandPanel: clicked header, waiting for course items...')

  const body = await waitForElement('.course-list-item-container', panel)
  if (!body) {
    api?.logger.warn('[dom-debug] expandPanel: waitForElement timed out, using fallback delay')
    await delay(800)
  }
  const result = isPanelExpanded(panel)
  api?.logger.info(`[dom-debug] expandPanel: completed, expanded=${result}`)
  return result
}

/**
 * Get all course item containers within an expanded panel.
 */
export function getCourseItems(panel: Element): Element[] {
  return Array.from(panel.querySelectorAll('.course-list-item-container'))
}

/**
 * Check if a course item is currently selected.
 */
export function isCourseSelected(courseItem: Element): boolean {
  if (courseItem.classList.contains('course-list-item-container--selected')) {
    return true
  }

  const checkbox = courseItem.querySelector('input[type="checkbox"]') as HTMLInputElement | null
  if (!checkbox) return false

  if (checkbox.checked) return true
  if (checkbox.getAttribute('aria-checked') === 'true') return true

  return false
}

/**
 * Click the checkbox within a course item to toggle selection.
 * For Angular Material checkboxes we try the label first, then fall back.
 */
export async function toggleCourse(courseItem: Element): Promise<void> {
  const api = getApi()
  const wasBefore = isCourseSelected(courseItem)

  const label = courseItem.querySelector('mat-checkbox label, .mat-mdc-checkbox label')
  if (label) {
    api?.logger.info('[dom-debug] toggleCourse: clicking label target')
    ;(label as HTMLElement).click()
  } else {
    const touchTarget = courseItem.querySelector('.mat-mdc-checkbox-touch-target')
    if (touchTarget) {
      api?.logger.info('[dom-debug] toggleCourse: clicking touchTarget fallback')
      ;(touchTarget as HTMLElement).click()
    } else {
      const checkbox =
        courseItem.querySelector('mat-checkbox') ??
        courseItem.querySelector('.mat-mdc-checkbox') ??
        courseItem.querySelector('input[type="checkbox"]')
      if (checkbox) {
        api?.logger.info('[dom-debug] toggleCourse: clicking checkbox fallback')
        ;(checkbox as HTMLElement).click()
      } else {
        api?.logger.warn('[dom-debug] toggleCourse: no click target found')
      }
    }
  }

  await delay(100)
  const isAfter = isCourseSelected(courseItem)
  if (wasBefore === isAfter) {
    api?.logger.warn('toggleCourse: --selected class did not change after click')
  }
}
