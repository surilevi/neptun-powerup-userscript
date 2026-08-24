import { delay } from '../../utils/async'
import { isElementAvailable } from '../../utils/element-availability'
import {
  createPlannerDiagnostics,
  type PlannerDiagnosticOperation,
  type PlannerDiagnostics,
} from './planner-diagnostics'
import { PLANNER_TIMING } from './planner-policy'
import { fetchPlannedSubjects, type PlannedSubject } from './planner-api'
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

/**
 * Neptun renders the planner's subject list and the main registration list with
 * the same `neptun-subject-list-item` component. Only the container id prefix
 * distinguishes them, so it is the last line of defence against NPU ever acting
 * on the full paginated registration list instead of the planner's short list.
 */
const PLANNER_SUBJECT_CONTAINER_ID_PREFIX = 'signed-and-scheduled-subjects'

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
  /** Ground truth from Neptun's planner API; null when it was unavailable. */
  plannedFromApi: PlannedSubject[] | null
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
  if (!text) return false

  return [
    'nincs megjelenitheto adat',
    'nincs tervezohoz adott targy',
    'no planned subjects',
    'no data to display',
  ].some((message) => text.includes(message))
}

export function getPlannerRoot(): Element | null {
  return document.querySelector(PLANNER_ROOT_SELECTOR)
}

/**
 * The planner host and its list view are both planner-only components, so either
 * ancestor proves an element belongs to the planner rather than to the main
 * registration list.
 */
function isInPlannerScope(element: Element): boolean {
  return element.closest(`${PLANNER_ROOT_SELECTOR}, ${PLANNER_LIST_SELECTOR}`) !== null
}

export function getPlannerListRoot(): Element | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(PLANNER_LIST_SELECTOR)).find((root) =>
      isElementAvailable(root),
    ) ?? null
  )
}

/**
 * Planner subject panels, scoped to an explicit root.
 *
 * The root is required on purpose. An earlier version defaulted to `document`
 * when the planner list was missing, which silently matched every subject of the
 * main registration list instead.
 */
export function getPlannerSubjectPanels(root: ParentNode): Element[] {
  const scoped = Array.from(root.querySelectorAll('neptun-subject-list-item mat-expansion-panel'))
  const panels =
    scoped.length > 0 ? scoped : Array.from(root.querySelectorAll('mat-expansion-panel'))

  return panels.filter(isPlannerSubjectPanel)
}

function isPlannerSubjectPanel(panel: Element): boolean {
  if (!isInPlannerScope(panel)) return false

  // When ids are present, require the planner's own container prefix.
  const container = panel.closest('[id]')
  const id = container?.id ?? ''
  if (!id) return true

  return (
    !id.startsWith('subject-registration') || id.startsWith(PLANNER_SUBJECT_CONTAINER_ID_PREFIX)
  )
}

export function findPlannerSubjectPanel(subjectCode: string, root: ParentNode): Element | null {
  return (
    getPlannerSubjectPanels(root).find((panel) => extractSubjectCode(panel) === subjectCode) ?? null
  )
}

function isPlannerToggleText(text: string): boolean {
  const normalized = normalizeText(text)
  return normalized.includes('orarendtervezo') || normalized.includes('timetable planner')
}

function findPlannerToggle(): HTMLButtonElement | null {
  const exact = Array.from(document.querySelectorAll<HTMLButtonElement>(PLANNER_TOGGLE_SELECTOR))
  const availableExact = exact.find((button) => isElementAvailable(button))
  if (availableExact) return availableExact

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
  return (
    Array.from(document.querySelectorAll<HTMLElement>('mat-option, [role="option"]')).find(
      (option) => isElementAvailable(option) && isListViewText(option.textContent ?? ''),
    ) ?? null
  )
}

type PlannerOpenState = 'open' | 'closed' | 'unknown'

/**
 * Rendered planner content proves it is open. The toggle's aria-label is only
 * consulted when there is no content yet, because that label is precisely what
 * flips underneath us while Neptun is still opening the planner itself.
 */
function readPlannerOpenState(): PlannerOpenState {
  if (getPlannerListRoot() || findPlannerViewControl()) return 'open'

  const toggle = findPlannerToggle()
  if (!toggle) return 'unknown'

  const label = normalizeText(
    `${toggle.getAttribute('aria-label') ?? ''} ${toggle.textContent ?? ''}`,
  )
  if (label.includes('megnyit') || label.includes('open')) return 'closed'
  if (label.includes('bezar') || label.includes('close')) return 'open'

  // A control that only names the planner, with nothing rendered yet, is closed.
  if (isPlannerToggleText(label)) return 'closed'

  // Anything else is an unidentified control and must never be clicked blindly.
  return 'unknown'
}

/**
 * Rate-limits repeated clicks on the same planner control.
 *
 * Neptun opens the planner by itself during page load. Clicking on every poll
 * tick would fight that and leave the planner closed, which is exactly the
 * failure this gate exists to prevent.
 */
class ControlActionGate {
  private readonly lastActionAt = new Map<string, number>()
  private readonly attempts = new Map<string, number>()

  canAct(key: string, cooldownMs: number): boolean {
    if (this.attemptsFor(key) >= PLANNER_TIMING.controlActionMaxAttempts) return false

    const last = this.lastActionAt.get(key)
    return last === undefined || Date.now() - last >= cooldownMs
  }

  record(key: string): void {
    this.lastActionAt.set(key, Date.now())
    this.attempts.set(key, this.attemptsFor(key) + 1)
  }

  attemptsFor(key: string): number {
    return this.attempts.get(key) ?? 0
  }
}

/**
 * Drive the planner into "list view, rendered" by repeatedly observing state and
 * taking at most one corrective step per tick.
 *
 * Every step is re-verified on the next tick instead of being assumed to have
 * worked, so a click that Angular swallowed, a view that reverts, or a planner
 * that Neptun closes again all self-correct until the deadline.
 */
async function acquirePlannerListView(
  deadline: number,
  diagnostics: PlannerDiagnostics,
): Promise<PlannerPreparationResult> {
  const gate = new ControlActionGate()
  let openedPlanner = false
  let switchedToList = false
  let lastState = ''

  while (Date.now() < deadline) {
    const listRoot = getPlannerListRoot()
    if (listRoot) {
      return { root: listRoot, openedPlanner, switchedToList, error: null }
    }

    const openState = readPlannerOpenState()
    const viewControl = findPlannerViewControl()
    const state = `${openState}|${viewControl ? 'view' : 'no-view'}`
    if (state !== lastState) {
      lastState = state
      diagnostics.log('acquire:state', {
        open: openState,
        viewControl: viewControl !== null,
        toggleAttempts: gate.attemptsFor('toggle'),
        viewAttempts: gate.attemptsFor('view'),
      })
    }

    if (openState === 'closed') {
      // The settle window is what stops NPU from racing Neptun's own auto-open:
      // a click is given time to take effect before the state is judged again.
      const toggle = findPlannerToggle()
      if (toggle && gate.canAct('toggle', PLANNER_TIMING.controlActionSettleMs)) {
        diagnostics.log('acquire:toggle-click', { attempt: gate.attemptsFor('toggle') + 1 })
        toggle.click()
        gate.record('toggle')
        openedPlanner = true
      }

      await delay(PLANNER_TIMING.domPollIntervalMs)
      continue
    }

    // Planner is open (or still rendering). Nudge the view selector to list view.
    if (viewControl && !isListViewText(viewControl.textContent ?? '')) {
      const listOption = findListViewOption()
      if (listOption) {
        diagnostics.log('acquire:list-option-click')
        listOption.click()
        gate.record('view')
        switchedToList = true
      } else if (gate.canAct('view', PLANNER_TIMING.controlActionCooldownMs)) {
        diagnostics.log('acquire:view-selector-click', { attempt: gate.attemptsFor('view') + 1 })
        getViewClickTarget(viewControl).click()
        gate.record('view')
      }
    }

    // Once the click budget is spent NPU stops acting but keeps observing:
    // a slow planner may still finish opening well within the deadline.
    await delay(PLANNER_TIMING.domPollIntervalMs)
  }

  return {
    root: null,
    openedPlanner,
    switchedToList,
    error: describeAcquisitionFailure(readPlannerOpenState(), gate),
  }
}

function describeAcquisitionFailure(state: PlannerOpenState, gate: ControlActionGate): string {
  if (state === 'unknown') {
    return 'Neptun timetable planner toggle action could not be identified safely'
  }

  if (state === 'closed') {
    return gate.attemptsFor('toggle') > 0
      ? `Neptun timetable planner did not stay open after ${gate.attemptsFor('toggle')} attempts`
      : 'Neptun timetable planner did not open in time'
  }

  return 'Neptun timetable planner list did not render in time'
}

export async function preparePlannerListView(
  options: PlannerPreparationOptions = {},
): Promise<PlannerPreparationResult> {
  const diagnostics =
    options.diagnostics ?? createPlannerDiagnostics(options.operation ?? 'prepare')
  const timeoutMs = options.entryPointTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs

  diagnostics.log('prepare:start', {
    readinessTimeoutMs: timeoutMs,
    pollIntervalMs: PLANNER_TIMING.domPollIntervalMs,
  })

  const result = await acquirePlannerListView(Date.now() + timeoutMs, diagnostics)

  diagnostics.log(result.root ? 'prepare:ready' : 'prepare:failed', {
    openedPlanner: result.openedPlanner,
    switchedToList: result.switchedToList,
    failure: result.error,
  })
  return result
}

function findEnrollmentButton(panel: Element): HTMLButtonElement | null {
  return (
    Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      isEnrollButtonText(button.textContent ?? ''),
    ) ?? null
  )
}

function countSelectedCourseItems(panel: Element): number {
  return getCourseItems(panel).filter((item) => isCourseSelected(item)).length
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

/**
 * Wait until the planner's subject list has stopped changing.
 *
 * Emptiness is only ever concluded from a positive signal — Neptun's explicit
 * empty-state text, or the planner API reporting zero planned subjects — never
 * from "no panels yet", which is also what a slow connection looks like.
 */
async function waitForStableSubjectList(
  root: Element,
  deadline: number,
  apiPlannedCount: number | null,
  diagnostics: PlannerDiagnostics,
): Promise<{ panels: Element[]; explicitlyEmpty: boolean }> {
  let lastSignature = ''
  let stableSince = Date.now()

  while (Date.now() < deadline) {
    const panels = getPlannerSubjectPanels(root)
    const codes = panels.map((panel) => extractSubjectCode(panel))
    const allCodesReady = panels.length > 0 && codes.every((code) => code !== null)

    if (allCodesReady) {
      // Trust the API's count when we have it: the DOM is only settled once it agrees.
      const matchesApi = apiPlannedCount === null || panels.length >= apiPlannedCount
      const signature = codes.join('|')

      if (matchesApi && signature === lastSignature) {
        if (Date.now() - stableSince >= PLANNER_TIMING.listStabilityWindowMs) {
          return { panels, explicitlyEmpty: false }
        }
      } else {
        lastSignature = signature
        stableSince = Date.now()
      }
    }

    if (apiPlannedCount === 0) {
      diagnostics.log('subject-list:empty-confirmed-by-api')
      return { panels: [], explicitlyEmpty: true }
    }

    if (panels.length === 0 && isPlannerExplicitlyEmpty(root)) {
      diagnostics.log('subject-list:empty-state-rendered')
      return { panels: [], explicitlyEmpty: true }
    }

    await delay(PLANNER_TIMING.domPollIntervalMs)
  }

  return { panels: getPlannerSubjectPanels(root), explicitlyEmpty: false }
}

export async function collectPlannerSnapshot(
  options: PlannerPreparationOptions = {},
): Promise<PlannerSnapshot> {
  const diagnostics =
    options.diagnostics ?? createPlannerDiagnostics(options.operation ?? 'prepare')
  const contentTimeoutMs = options.contentTimeoutMs ?? PLANNER_TIMING.interactiveReadinessTimeoutMs

  // Ground truth is fetched in parallel with opening the planner: it costs
  // nothing on the critical path and tells us what the DOM *should* converge to.
  const apiPromise = fetchPlannedSubjects().catch(() => null)

  const preparation = await preparePlannerListView({ ...options, diagnostics })
  const apiResult = await apiPromise
  const plannedFromApi = apiResult?.ok ? apiResult.subjects : null
  const apiPlannedCount = plannedFromApi?.length ?? null

  diagnostics.log('api:planned-subjects', {
    ok: apiResult?.ok ?? false,
    // A successful call reports `failure: null`, so `?? 'unavailable'` used to
    // label every healthy read as a failure in the one log a rush is debugged from.
    failure: apiResult ? (apiResult.failure ?? 'none') : 'unavailable',
    count: apiPlannedCount,
  })

  if (!preparation.root) {
    return {
      diagnosticRunId: diagnostics.runId,
      preparation,
      contentReady: false,
      listedSubjects: 0,
      subjects: [],
      plannedFromApi,
      issues: [preparation.error ?? 'Neptun timetable planner list is unavailable'],
    }
  }

  const issues: string[] = []
  const subjects: PlannerSubjectTarget[] = []
  const contentDeadline = Date.now() + contentTimeoutMs

  diagnostics.log('subject-list:waiting', {
    timeoutMs: contentTimeoutMs,
    stabilityWindowMs: PLANNER_TIMING.listStabilityWindowMs,
    expectedFromApi: apiPlannedCount,
  })

  const { panels: plannerPanels, explicitlyEmpty } = await waitForStableSubjectList(
    preparation.root,
    contentDeadline,
    apiPlannedCount,
    diagnostics,
  )

  const subjectEntries = plannerPanels
    .map((panel) => ({ panel, subjectCode: extractSubjectCode(panel) }))
    .filter((entry): entry is { panel: Element; subjectCode: string } => entry.subjectCode !== null)

  if (subjectEntries.length === 0) {
    diagnostics.log('snapshot:complete', {
      contentReady: explicitlyEmpty,
      listedSubjects: plannerPanels.length,
      readableSubjects: 0,
      issueCount: 1,
    })
    return {
      diagnosticRunId: diagnostics.runId,
      preparation,
      contentReady: explicitlyEmpty,
      listedSubjects: plannerPanels.length,
      subjects,
      plannedFromApi,
      issues: [
        explicitlyEmpty
          ? 'No planned subjects are visible in Neptun timetable planner list view'
          : plannerPanels.length === 0
            ? 'Neptun timetable planner subjects did not finish loading'
            : 'Planner subjects are visible, but their subject codes could not be read safely',
      ],
    }
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

  // Rows render before Neptun marks which of them the planner actually holds, so
  // waiting for rows alone can snapshot a panel whose selection is still empty and
  // drop that subject from the run. Prefer the API's own per-subject count as the
  // completion signal, and require the selection to stop changing either way.
  const expectedSelectedBySubject = new Map<string, number>()
  for (const planned of plannedFromApi ?? []) {
    expectedSelectedBySubject.set(planned.code, planned.scheduledCourseIds.length)
  }

  diagnostics.log('course-rows:waiting', {
    timeoutMs: contentTimeoutMs,
    expectationSource: expectedSelectedBySubject.size > 0 ? 'api' : 'stability',
    stabilityWindowMs: PLANNER_TIMING.courseSelectionStabilityWindowMs,
  })

  const readSelectionSignature = (): string =>
    expandedEntries
      .map(({ subjectCode, panel }) => `${subjectCode}:${countSelectedCourseItems(panel)}`)
      .join('|')

  const waitStartedAt = Date.now()
  const emptySelectionDeadline = waitStartedAt + PLANNER_TIMING.emptySelectionGraceMs
  let lastSignature = readSelectionSignature()
  let signatureStableSince = Date.now()

  while (Date.now() < contentDeadline) {
    const signature = readSelectionSignature()
    if (signature !== lastSignature) {
      lastSignature = signature
      signatureStableSince = Date.now()
    }

    const everyPanelHasRows = expandedEntries.every(({ panel }) => getCourseItems(panel).length > 0)
    // A count that has not moved is not evidence that it finished: a subject whose
    // selection has not been applied yet reads a perfectly stable zero. Compare
    // against the API's own count where there is one, and otherwise give an empty
    // selection a bounded grace period before believing it.
    const selectionResolved = expandedEntries.every(({ subjectCode, panel }) => {
      const expected = expectedSelectedBySubject.get(subjectCode)
      const actual = countSelectedCourseItems(panel)
      if (expected !== undefined) return actual >= expected
      return actual > 0 || Date.now() >= emptySelectionDeadline
    })
    const selectionSettled =
      Date.now() - signatureStableSince >= PLANNER_TIMING.courseSelectionStabilityWindowMs

    if (everyPanelHasRows && selectionResolved && selectionSettled) break

    await delay(PLANNER_TIMING.domPollIntervalMs)
  }

  const unmetExpectations = expandedEntries.filter(({ subjectCode, panel }) => {
    const expected = expectedSelectedBySubject.get(subjectCode)
    return expected !== undefined && countSelectedCourseItems(panel) < expected
  }).length

  diagnostics.log('course-rows:ready', {
    waitedMs: Date.now() - waitStartedAt,
    selectedRows: expandedEntries.reduce(
      (sum, { panel }) => sum + countSelectedCourseItems(panel),
      0,
    ),
    expectedRows:
      expectedSelectedBySubject.size > 0
        ? Array.from(expectedSelectedBySubject.values()).reduce((sum, count) => sum + count, 0)
        : null,
    unmetExpectations,
  })

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

  diagnostics.log('snapshot:complete', {
    contentReady: true,
    listedSubjects: plannerPanels.length,
    readableSubjects: subjects.length,
    issueCount: issues.length,
  })

  return {
    diagnosticRunId: diagnostics.runId,
    preparation,
    contentReady: true,
    listedSubjects: plannerPanels.length,
    subjects,
    plannedFromApi,
    issues,
  }
}

export function closePlannerIfOpenedByNpu(preparation: PlannerPreparationResult): boolean {
  if (!preparation.openedPlanner) return false
  return closePlannerSafely()
}

export function closePlannerSafely(): boolean {
  if (readPlannerOpenState() !== 'open') return false

  const toggle = findPlannerToggle()
  if (!toggle) return false

  toggle.click()
  return true
}
