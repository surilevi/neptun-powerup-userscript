import { delay } from '../../utils/async'
import { isElementAvailable } from '../../utils/element-availability'
import {
  createPlannerDiagnostics,
  type PlannerDiagnosticOperation,
  type PlannerDiagnostics,
} from './planner-diagnostics'
import { PLANNER_TIMING } from './planner-policy'
import {
  expandPanel,
  extractCourseCode,
  extractSubjectCode,
  getCourseItems,
  isCourseSelected,
  isEnrollButtonText,
} from './dom'

const PLANNER_ROOT_SELECTOR = 'neptun-timetable-planner'
const PLANNER_LIST_SELECTOR = 'neptun-timetable-planner-list-view'
const PLANNER_TOGGLE_SELECTOR = 'button.timetable-planner__toggle-button'
const PLANNER_VIEW_SELECT_ID = 'timetable-planner-view-typeSelect'

export interface PlannerPreparationOptions {
  entryPointTimeoutMs?: number
  contentTimeoutMs?: number
  diagnostics?: PlannerDiagnostics
  operation?: PlannerDiagnosticOperation
}

export interface PlannerPreparationResult {
  root: Element | null
  openedPlanner: boolean
  switchedToList: boolean
  error: string | null
}

export interface PlannerSubjectTarget {
  subjectCode: string
  panel: Element
  selectedCourseItems: Element[]
  courseCodes: string[]
  enrollmentButton: HTMLButtonElement | null
  available: boolean
  issue: string | null
}

export interface PlannerSnapshot {
  diagnosticRunId: string
  preparation: PlannerPreparationResult
  contentReady: boolean
  listedSubjects: number
  subjects: PlannerSubjectTarget[]
  issues: string[]
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isListViewText(text: string): boolean {
  const normalized = normalizeText(text)
  return normalized.includes('lista nezet') || normalized.includes('list view')
}

function isPlannerExplicitlyEmpty(root: Element): boolean {
  const text = normalizeText(root.textContent ?? '')
  return [
    'nincs megjelenitheto adat',
    'nincs tervezőhoz adott targy',
    'nincs tervezőhöz adott tárgy',
    'no planned subjects',
    'no data to display',
  ].some((message) => text.includes(normalizeText(message)))
}

async function waitForValue<T>(
  read: () => T | null,
  timeoutMs: number = PLANNER_TIMING.interactiveReadinessTimeoutMs,
): Promise<T | null> {
  const startedAt = Date.now()
  let value = read()

  while (value === null && Date.now() - startedAt < timeoutMs) {
    await delay(PLANNER_TIMING.domPollIntervalMs)
    value = read()
  }

  return value
}

export function getPlannerListRoot(): Element | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(PLANNER_LIST_SELECTOR)).find((root) =>
      isElementAvailable(root),
    ) ?? null
  )
}

function getPlannerRoot(): Element | null {
  return document.querySelector(PLANNER_ROOT_SELECTOR)
}

function isPlannerToggleText(text: string): boolean {
  const normalized = normalizeText(text)
  return normalized.includes('orarendtervezo') || normalized.includes('timetable planner')
}

function findPlannerToggle(): HTMLButtonElement | null {
  const exactMatches = Array.from(
    document.querySelectorAll<HTMLButtonElement>(PLANNER_TOGGLE_SELECTOR),
  )
  const availableExactMatch = exactMatches.find((button) => isElementAvailable(button))
  if (availableExactMatch) return availableExactMatch

  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) =>
        isElementAvailable(button) &&
        isPlannerToggleText(
          `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`,
        ),
    ) ?? null
  )
}

function getPlannerToggleAction(button: HTMLButtonElement): 'open' | 'close' | 'unknown' {
  const label = normalizeText(
    `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`,
  )

  if (label.includes('megnyit') || label.includes('open')) return 'open'
  if (label.includes('bezar') || label.includes('close')) return 'close'

  if (isPlannerToggleText(label)) {
    return getPlannerListRoot() || findPlannerViewControl() ? 'close' : 'open'
  }

  return 'unknown'
}

function findPlannerViewControl(): HTMLElement | null {
  const exact = document.getElementById(PLANNER_VIEW_SELECT_ID)
  if (exact && isElementAvailable(exact)) return exact

  const planner = getPlannerRoot()
  if (!planner) return null

  return (
    Array.from(
      planner.querySelectorAll<HTMLElement>(
        `#${PLANNER_VIEW_SELECT_ID}, neptun-form-select-v2 mat-select, neptun-form-select-v2 [role="combobox"], neptun-form-select-v2`,
      ),
    ).find((control) => isElementAvailable(control)) ?? null
  )
}

function getViewClickTarget(control: HTMLElement): HTMLElement {
  return (
    control.querySelector<HTMLElement>('[role="combobox"], mat-select, .mat-mdc-select-trigger') ??
    control
  )
}

function findListViewOption(): HTMLElement | null {
  const options = Array.from(document.querySelectorAll<HTMLElement>('mat-option, [role="option"]'))
  return (
    options.find(
      (option) => isElementAvailable(option) && isListViewText(option.textContent ?? ''),
    ) ?? null
  )
}

type PlannerEntryPoint =
  | { type: 'list'; element: Element }
  | { type: 'view'; element: HTMLElement }
  | { type: 'toggle'; element: HTMLButtonElement }

function findSafePlannerEntryPoint(): PlannerEntryPoint | null {
  const list = getPlannerListRoot()
  if (list) return { type: 'list', element: list }

  const view = findPlannerViewControl()
  if (view) return { type: 'view', element: view }

  const toggle = findPlannerToggle()
  if (toggle && getPlannerToggleAction(toggle) !== 'unknown') {
    return { type: 'toggle', element: toggle }
  }

  return null
}

function finishPreparation(
  diagnostics: PlannerDiagnostics,
  result: PlannerPreparationResult,
): PlannerPreparationResult {
  diagnostics.log(result.root ? 'prepare:ready' : 'prepare:failed', {
    openedPlanner: result.openedPlanner,
    switchedToList: result.switchedToList,
    failure: result.error,
  })
  return result
}

export async function preparePlannerListView(
  options: PlannerPreparationOptions = {},
): Promise<PlannerPreparationResult> {
  const diagnostics =
    options.diagnostics ?? createPlannerDiagnostics(options.operation ?? 'prepare')
  const entryPointTimeoutMs =
    options.entryPointTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs
  diagnostics.log('prepare:start', {
    readinessTimeoutMs: entryPointTimeoutMs,
    pollIntervalMs: PLANNER_TIMING.domPollIntervalMs,
  })

  const existingList = getPlannerListRoot()
  if (existingList) {
    return finishPreparation(diagnostics, {
      root: existingList,
      openedPlanner: false,
      switchedToList: false,
      error: null,
    })
  }

  let openedPlanner = false
  diagnostics.log('entry-point:waiting', {
    timeoutMs: entryPointTimeoutMs,
  })
  const entryPoint = await waitForValue(findSafePlannerEntryPoint, entryPointTimeoutMs)

  if (!entryPoint) {
    const unidentifiedToggle = findPlannerToggle()
    return finishPreparation(diagnostics, {
      root: null,
      openedPlanner,
      switchedToList: false,
      error: unidentifiedToggle
        ? 'Neptun timetable planner toggle appeared, but its action could not be identified safely'
        : `Neptun timetable planner controls did not appear within ${Math.ceil(entryPointTimeoutMs / 1000)} seconds`,
    })
  }
  diagnostics.log('entry-point:ready', { type: entryPoint.type })

  if (entryPoint.type === 'list') {
    return finishPreparation(diagnostics, {
      root: entryPoint.element,
      openedPlanner: false,
      switchedToList: false,
      error: null,
    })
  }

  let viewControl = entryPoint.type === 'view' ? entryPoint.element : findPlannerViewControl()

  if (!viewControl) {
    const toggle =
      entryPoint.type === 'toggle' && entryPoint.element.isConnected
        ? entryPoint.element
        : findPlannerToggle()
    if (!toggle) {
      return finishPreparation(diagnostics, {
        root: null,
        openedPlanner,
        switchedToList: false,
        error: 'Neptun timetable planner toggle was not found',
      })
    }

    const action = getPlannerToggleAction(toggle)
    if (action !== 'open') {
      return finishPreparation(diagnostics, {
        root: null,
        openedPlanner,
        switchedToList: false,
        error:
          action === 'close'
            ? 'Neptun timetable planner is open but its view selector is not ready'
            : 'Neptun timetable planner toggle action could not be identified safely',
      })
    }

    diagnostics.log('planner-toggle:click', { action })
    toggle.click()
    openedPlanner = true

    diagnostics.log('planner-open:waiting', { timeoutMs: entryPointTimeoutMs })
    const plannerReady = await waitForValue(() => {
      const list = getPlannerListRoot()
      if (list) return { list, viewControl: null }

      const control = findPlannerViewControl()
      return control ? { list: null, viewControl: control } : null
    }, entryPointTimeoutMs)
    if (plannerReady?.list) {
      return finishPreparation(diagnostics, {
        root: plannerReady.list,
        openedPlanner,
        switchedToList: false,
        error: null,
      })
    }

    viewControl = plannerReady?.viewControl ?? null
    if (!viewControl) {
      return finishPreparation(diagnostics, {
        root: null,
        openedPlanner,
        switchedToList: false,
        error: 'Neptun timetable planner did not finish opening',
      })
    }
  }

  if (isListViewText(viewControl.textContent ?? '')) {
    diagnostics.log('list-view:waiting', { timeoutMs: entryPointTimeoutMs })
    const listRoot = await waitForValue(getPlannerListRoot, entryPointTimeoutMs)
    return finishPreparation(diagnostics, {
      root: listRoot,
      openedPlanner,
      switchedToList: false,
      error: listRoot ? null : 'Neptun timetable planner list did not render',
    })
  }

  diagnostics.log('view-selector:click')
  getViewClickTarget(viewControl).click()
  diagnostics.log('list-option:waiting', { timeoutMs: entryPointTimeoutMs })
  const listOption = await waitForValue(findListViewOption, entryPointTimeoutMs)
  if (!listOption) {
    return finishPreparation(diagnostics, {
      root: null,
      openedPlanner,
      switchedToList: false,
      error: 'Neptun timetable planner list-view option was not found',
    })
  }

  diagnostics.log('list-option:click')
  listOption.click()
  diagnostics.log('list-view:waiting', { timeoutMs: entryPointTimeoutMs })
  const listRoot = await waitForValue(getPlannerListRoot, entryPointTimeoutMs)
  return finishPreparation(diagnostics, {
    root: listRoot,
    openedPlanner,
    switchedToList: true,
    error: listRoot ? null : 'Neptun timetable planner list did not render',
  })
}

export function getPlannerSubjectPanels(
  root: ParentNode = getPlannerListRoot() ?? document,
): Element[] {
  const scopedPanels = Array.from(
    root.querySelectorAll('neptun-subject-list-item mat-expansion-panel'),
  )
  if (scopedPanels.length > 0) return scopedPanels

  return Array.from(root.querySelectorAll('mat-expansion-panel'))
}

export function findPlannerSubjectPanel(
  subjectCode: string,
  root: ParentNode = getPlannerListRoot() ?? document,
): Element | null {
  return (
    getPlannerSubjectPanels(root).find((panel) => extractSubjectCode(panel) === subjectCode) ?? null
  )
}

function findEnrollmentButton(panel: Element): HTMLButtonElement | null {
  const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
  return buttons.find((button) => isEnrollButtonText(button.textContent ?? '')) ?? null
}

function readExpandedPlannerSubject(subjectCode: string, panel: Element): PlannerSubjectTarget {
  const selectedCourseItems = getCourseItems(panel).filter((item) => isCourseSelected(item))
  const courseCodes = Array.from(
    new Set(
      selectedCourseItems
        .map((item) => extractCourseCode(item))
        .filter((code): code is string => code !== null),
    ),
  )
  const enrollmentButton = findEnrollmentButton(panel)

  let issue: string | null = null
  if (selectedCourseItems.length === 0) {
    issue = `${subjectCode}: no planned course is selected`
  } else if (courseCodes.length !== selectedCourseItems.length) {
    issue = `${subjectCode}: one or more planned course codes could not be read`
  } else if (!enrollmentButton) {
    issue = `${subjectCode}: already registered or enrollment action unavailable`
  } else if (!isElementAvailable(enrollmentButton)) {
    issue = `${subjectCode}: enrollment action unavailable`
  }

  return {
    subjectCode,
    panel,
    selectedCourseItems,
    courseCodes,
    enrollmentButton,
    available: issue === null,
    issue,
  }
}

export function readPlannerSubjectTarget(
  subjectCode: string,
  preferredPanel?: Element,
): PlannerSubjectTarget | null {
  const root = getPlannerListRoot()
  if (!root) return null

  let panel =
    preferredPanel?.isConnected && root.contains(preferredPanel) ? preferredPanel : undefined

  if (!panel) {
    const matches = getPlannerSubjectPanels(root).filter(
      (candidate) => extractSubjectCode(candidate) === subjectCode,
    )
    if (matches.length !== 1) return null
    panel = matches[0]
  }

  return readExpandedPlannerSubject(subjectCode, panel)
}

function finishSnapshot(
  diagnostics: PlannerDiagnostics,
  snapshot: PlannerSnapshot,
): PlannerSnapshot {
  diagnostics.log('snapshot:complete', {
    contentReady: snapshot.contentReady,
    listedSubjects: snapshot.listedSubjects,
    readableSubjects: snapshot.subjects.length,
    issueCount: snapshot.issues.length,
  })
  return snapshot
}

export async function collectPlannerSnapshot(
  options: PlannerPreparationOptions = {},
): Promise<PlannerSnapshot> {
  const diagnostics =
    options.diagnostics ?? createPlannerDiagnostics(options.operation ?? 'prepare')
  const preparation = await preparePlannerListView({
    ...options,
    diagnostics,
  })
  if (!preparation.root) {
    return finishSnapshot(diagnostics, {
      diagnosticRunId: diagnostics.runId,
      preparation,
      contentReady: false,
      listedSubjects: 0,
      subjects: [],
      issues: [preparation.error ?? 'Neptun timetable planner list is unavailable'],
    })
  }

  const issues: string[] = []
  const subjects: PlannerSubjectTarget[] = []
  const contentTimeoutMs = options.contentTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs
  diagnostics.log('subject-list:waiting', {
    timeoutMs: contentTimeoutMs,
    stabilityWindowMs: PLANNER_TIMING.listStabilityWindowMs,
  })
  let lastSignature = ''
  let stableSince = 0
  const startedWaitingAt = Date.now()

  while (Date.now() - startedWaitingAt < contentTimeoutMs) {
    const panels = getPlannerSubjectPanels(preparation.root)
    const codes = panels.map((panel) => extractSubjectCode(panel))
    const allCodesReady = panels.length > 0 && codes.every((code) => code !== null)
    const signature = allCodesReady ? codes.join('|') : ''

    if (signature && signature === lastSignature) {
      if (Date.now() - stableSince >= PLANNER_TIMING.listStabilityWindowMs) {
        break
      }
    } else {
      lastSignature = signature
      stableSince = Date.now()
    }

    if (isPlannerExplicitlyEmpty(preparation.root)) break
    await delay(PLANNER_TIMING.domPollIntervalMs)
  }

  const plannerPanels = getPlannerSubjectPanels(preparation.root)
  const subjectEntries = plannerPanels
    .map((panel) => ({ panel, subjectCode: extractSubjectCode(panel) }))
    .filter((entry): entry is { panel: Element; subjectCode: string } => entry.subjectCode !== null)

  if (subjectEntries.length === 0) {
    const explicitlyEmpty = isPlannerExplicitlyEmpty(preparation.root)
    return finishSnapshot(diagnostics, {
      diagnosticRunId: diagnostics.runId,
      preparation,
      contentReady: explicitlyEmpty,
      listedSubjects: plannerPanels.length,
      subjects,
      issues: [
        explicitlyEmpty
          ? 'No planned subjects are visible in Neptun timetable planner list view'
          : plannerPanels.length === 0
            ? 'Neptun timetable planner subjects did not finish loading'
            : 'Planner subjects are visible, but their subject codes could not be read safely',
      ],
    })
  }

  diagnostics.log('subject-list:ready', {
    panelCount: plannerPanels.length,
    readableCount: subjectEntries.length,
  })
  const expandedEntries: Array<{ panel: Element; subjectCode: string }> = []
  for (const { subjectCode, panel } of subjectEntries) {
    if (!panel.isConnected) {
      issues.push(`${subjectCode}: planner subject disappeared before expansion`)
      continue
    }

    if (!(await expandPanel(panel))) {
      issues.push(`${subjectCode}: planner subject could not be expanded`)
      continue
    }

    expandedEntries.push({ subjectCode, panel })
  }

  diagnostics.log('subject-panels:expanded', {
    expandedCount: expandedEntries.length,
    failedCount: subjectEntries.length - expandedEntries.length,
  })
  const contentDeadline = Date.now() + contentTimeoutMs
  diagnostics.log('course-rows:waiting', { timeoutMs: contentTimeoutMs })
  while (
    Date.now() < contentDeadline &&
    expandedEntries.some(({ panel }) => getCourseItems(panel).length === 0)
  ) {
    await delay(PLANNER_TIMING.domPollIntervalMs)
  }

  for (const { subjectCode, panel } of expandedEntries) {
    if (getCourseItems(panel).length === 0) {
      issues.push(`${subjectCode}: planner course rows did not finish loading`)
      continue
    }

    const liveTarget = readPlannerSubjectTarget(subjectCode, panel)
    if (!liveTarget) {
      issues.push(`${subjectCode}: planner subject disappeared after expansion`)
      continue
    }

    subjects.push(liveTarget)
    if (liveTarget.issue) issues.push(liveTarget.issue)
  }

  return finishSnapshot(diagnostics, {
    diagnosticRunId: diagnostics.runId,
    preparation,
    contentReady: true,
    listedSubjects: plannerPanels.length,
    subjects,
    issues,
  })
}

export function closePlannerIfOpenedByNpu(preparation: PlannerPreparationResult): boolean {
  if (!preparation.openedPlanner) return false
  return closePlannerSafely()
}

export function closePlannerSafely(): boolean {
  const toggle = findPlannerToggle()
  if (!toggle || getPlannerToggleAction(toggle) !== 'close') return false

  toggle.click()
  return true
}
