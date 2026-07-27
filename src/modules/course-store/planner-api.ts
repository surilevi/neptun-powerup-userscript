import { SESSION_STORAGE_KEYS } from '../../types/neptun-api'
import { delay } from '../../utils/async'
import { PLANNER_TIMING } from './planner-policy'

/**
 * Read-only client for the endpoints Neptun's own timetable planner already calls.
 *
 * NPU still enrolls by clicking Neptun's real buttons. This client exists only to
 * replace guesswork with ground truth: which subjects are actually planned, which
 * are already registered, and whether Neptun will interrupt with a confirmation
 * popup. Every call here is a GET the page makes anyway.
 *
 * The whole layer is optional by design. If the token, the term, or the network
 * is unavailable the planner workflow must still work from the DOM alone, so
 * failures are reported as data and never thrown.
 */

const PLANNED_SUBJECTS_ENDPOINT = 'SubjectApplication/ScheduledSubjectsWithScheduledCourses'
const WARNING_MODAL_STATES_ENDPOINT = 'ContextUserProfile/GetSubjectSigninWarningModalsStates'

export type PlannerApiFailure =
  'no-token' | 'no-term' | 'unauthorized' | 'server-error' | 'network' | 'malformed'

export interface PlannedSubject {
  /** Subject code as shown in the panel header. */
  code: string
  title: string
  /** Course ids the user put in the planner. This is the exact enrollment intent. */
  scheduledCourseIds: string[]
  isRegistered: boolean
  isWaiting: boolean
  isInProgress: boolean
  isCompleted: boolean
  /** Neptun's own enrollability verdict; 0 means actionable. */
  uiDisplayStateType: number | null
}

export interface PlannedSubjectsResult {
  ok: boolean
  failure: PlannerApiFailure | null
  status: number | null
  subjects: PlannedSubject[]
}

export interface WarningModalStates {
  /** False means Neptun will interrupt enrollment with a confirmation popup. */
  scheduledCoursesInTimetableSuppressed: boolean | null
  oneSubjectCanBeTakenSuppressed: boolean | null
}

interface JsonEnvelope {
  data?: unknown
  notification?: unknown
}

function readAccessToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
  } catch {
    return null
  }
}

/**
 * Derive the API base from a request Neptun already made.
 *
 * Installations differ in their path prefix ("hallgato", "hallgatoi",
 * "ujhallgato"), so observing a real request beats hardcoding one. The location
 * fallback covers the case where nothing has been requested yet.
 */
export function resolveApiBase(): string {
  try {
    const entry = performance
      .getEntriesByType('resource')
      .map((resource) => resource.name)
      .find((name) => name.includes('/api/SubjectApplication/'))

    if (entry) {
      const marker = entry.indexOf('/api/')
      if (marker !== -1) return entry.slice(0, marker + '/api/'.length)
    }
  } catch {
    // fall through to the location-derived base
  }

  const prefix = window.location.pathname.split('/')[1] || 'hallgatoi'
  return `${window.location.origin}/${prefix}/api/`
}

/**
 * Reuse the term id Neptun itself requested rather than re-deriving which term
 * is "current". The planner and the subject list both carry it as a query
 * parameter, and mirroring it keeps NPU consistent with whatever the user has
 * selected in the term dropdown.
 */
export function resolveTermId(): string | null {
  let latest: { termId: string; startTime: number } | null = null

  try {
    for (const resource of performance.getEntriesByType('resource')) {
      if (!resource.name.includes('/api/SubjectApplication/')) continue

      let termId: string | null = null
      try {
        termId = new URL(resource.name).searchParams.get('request.termId')
      } catch {
        continue
      }

      if (!termId) continue
      if (!latest || resource.startTime >= latest.startTime) {
        latest = { termId, startTime: resource.startTime }
      }
    }
  } catch {
    return null
  }

  return latest?.termId ?? null
}

/**
 * Only talk to the API once Neptun has demonstrably used it on this page.
 *
 * Observing a real request is what supplies both the path prefix and the term
 * id, and it keeps NPU from inventing traffic in contexts (tests, an unexpected
 * portal layout) where it has no evidence the endpoint exists.
 */
export function isPlannerApiUsable(): boolean {
  return readAccessToken() !== null && resolveTermId() !== null
}

function isRetryableStatus(status: number): boolean {
  // 429 and 5xx are exactly what an overloaded registration server returns.
  return status === 429 || status >= 500
}

async function getJson(
  path: string,
  params: Record<string, string>,
): Promise<{
  envelope: JsonEnvelope | null
  failure: PlannerApiFailure | null
  status: number | null
}> {
  const token = readAccessToken()
  if (!token) return { envelope: null, failure: 'no-token', status: null }

  const url = new URL(resolveApiBase() + path)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  let lastStatus: number | null = null
  let lastFailure: PlannerApiFailure = 'network'

  for (let attempt = 1; attempt <= PLANNER_TIMING.apiMaxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PLANNER_TIMING.apiRequestTimeoutMs)

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'include',
        signal: controller.signal,
      })
      lastStatus = response.status

      if (response.status === 401 || response.status === 403) {
        return { envelope: null, failure: 'unauthorized', status: response.status }
      }

      if (!response.ok) {
        lastFailure = 'server-error'
        if (!isRetryableStatus(response.status)) {
          return { envelope: null, failure: 'server-error', status: response.status }
        }
      } else {
        try {
          return {
            envelope: (await response.json()) as JsonEnvelope,
            failure: null,
            status: response.status,
          }
        } catch {
          return { envelope: null, failure: 'malformed', status: response.status }
        }
      }
    } catch {
      lastFailure = 'network'
    } finally {
      clearTimeout(timer)
    }

    if (attempt < PLANNER_TIMING.apiMaxAttempts) {
      await delay(PLANNER_TIMING.apiRetryBaseDelayMs * attempt)
    }
  }

  return { envelope: null, failure: lastFailure, status: lastStatus }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function toPlannedSubject(raw: unknown): PlannedSubject | null {
  const record = asRecord(raw)
  if (!record) return null

  const code = typeof record.code === 'string' ? record.code.trim() : ''
  if (!code) return null

  const courseIds = Array.isArray(record.scheduledCourseIds)
    ? record.scheduledCourseIds.filter((id): id is string => typeof id === 'string')
    : []

  const uiState = asRecord(record.uiDisplayState)

  return {
    code,
    title: typeof record.title === 'string' ? record.title : '',
    scheduledCourseIds: courseIds,
    isRegistered: record.isRegistered === true,
    isWaiting: record.isWaiting === true,
    isInProgress: record.isInProgress === true,
    isCompleted: record.isCompleted === true,
    uiDisplayStateType: typeof uiState?.type === 'number' ? uiState.type : null,
  }
}

/**
 * Ground-truth list of what the user actually put in the timetable planner.
 * `withRegisteredSubjects` is requested so already-registered subjects come back
 * too and can be skipped deliberately instead of silently disappearing.
 */
export async function fetchPlannedSubjects(termId?: string | null): Promise<PlannedSubjectsResult> {
  const resolvedTermId = termId ?? resolveTermId()
  if (!resolvedTermId) {
    return { ok: false, failure: 'no-term', status: null, subjects: [] }
  }

  const { envelope, failure, status } = await getJson(PLANNED_SUBJECTS_ENDPOINT, {
    'request.termId': resolvedTermId,
    'request.withRegisteredSubjects': 'true',
  })

  if (failure) return { ok: false, failure, status, subjects: [] }
  if (!Array.isArray(envelope?.data)) {
    return { ok: false, failure: 'malformed', status, subjects: [] }
  }

  const subjects = envelope.data
    .map(toPlannedSubject)
    .filter((subject): subject is PlannedSubject => subject !== null)

  return { ok: true, failure: null, status, subjects }
}

/**
 * Whether Neptun's own registration confirmation popup is suppressed.
 *
 * Knowing this up front lets NPU warn before a rush instead of discovering it
 * mid-run and aborting with subjects left unclicked.
 */
export async function fetchWarningModalStates(): Promise<WarningModalStates> {
  if (!isPlannerApiUsable()) {
    return { scheduledCoursesInTimetableSuppressed: null, oneSubjectCanBeTakenSuppressed: null }
  }

  const { envelope } = await getJson(WARNING_MODAL_STATES_ENDPOINT, {})
  const data = asRecord(envelope?.data)

  return {
    scheduledCoursesInTimetableSuppressed:
      typeof data?.scheduledCoursesInTimetableDontAppearAgain === 'boolean'
        ? data.scheduledCoursesInTimetableDontAppearAgain
        : null,
    oneSubjectCanBeTakenSuppressed:
      typeof data?.oneSubjectCanBeTakenDontAppearAgain === 'boolean'
        ? data.oneSubjectCanBeTakenDontAppearAgain
        : null,
  }
}
