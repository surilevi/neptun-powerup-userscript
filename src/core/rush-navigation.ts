import { SESSION_STORAGE_KEYS } from '../types/neptun-api'

/**
 * Getting a rush onto the right page after login.
 *
 * The SPA-only redirect that used to live in `index.ts` assumed logging in emits
 * a route change away from `/login`. A real credential login (and the queue some
 * universities put in front of it) finishes with a full page load instead, so
 * that event never arrives and the rush silently never starts. This module
 * therefore decides from the *current* page state — am I authenticated, am I
 * already where the rush needs to be — rather than from a transition.
 */

export type RushKind = 'course' | 'exam'

const RUSH_PATHS: Record<RushKind, string> = {
  course: 'subjects/registration',
  exam: 'exams/overview/registration',
}

/**
 * Per-tab redirect budget. If Neptun bounces us back (maintenance, queue, an
 * expired session) we must not ping-pong forever.
 */
const REDIRECT_COUNT_KEY = 'npu:rushRedirectCount'
const MAX_REDIRECTS = 2

export function hasAccessToken(): boolean {
  try {
    return Boolean(sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken))
  } catch {
    return false
  }
}

/** Neptun installations differ: "hallgato", "hallgatoi", "ujhallgato". */
export function getPortalPrefix(pathname: string = window.location.pathname): string {
  return pathname.split('/')[1] || 'hallgatoi'
}

/** Derived from the supplied path so the caller's view of the page always wins. */
export function buildRushUrl(kind: RushKind, pathname: string, origin: string): string {
  return `${origin}/${getPortalPrefix(pathname)}/${RUSH_PATHS[kind]}`
}

export function isOnRushPage(kind: RushKind, path: string): boolean {
  return path.includes(`/${RUSH_PATHS[kind]}`)
}

export function isOnLoginPage(path: string): boolean {
  return path.endsWith('/login') || path === '/login'
}

function readRedirectCount(): number {
  try {
    const raw = sessionStorage.getItem(REDIRECT_COUNT_KEY)
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

function noteRedirect(): void {
  try {
    sessionStorage.setItem(REDIRECT_COUNT_KEY, String(readRedirectCount() + 1))
  } catch {
    // A missing counter only costs us the loop guard; never block the rush.
  }
}

export function clearRedirectBudget(): void {
  try {
    sessionStorage.removeItem(REDIRECT_COUNT_KEY)
  } catch {
    // ignore
  }
}

export type RushRedirectDecision =
  | { action: 'navigate'; url: string }
  | { action: 'already-there' }
  | { action: 'wait-for-login' }
  | { action: 'budget-exhausted' }

/**
 * Pure decision step, so the rush-day behaviour is testable without a browser.
 */
export function decideRushRedirect(
  kind: RushKind,
  path: string,
  authenticated: boolean,
  redirectCount: number = readRedirectCount(),
  origin: string = window.location.origin,
): RushRedirectDecision {
  if (isOnRushPage(kind, path)) return { action: 'already-there' }
  if (!authenticated || isOnLoginPage(path)) return { action: 'wait-for-login' }
  if (redirectCount >= MAX_REDIRECTS) return { action: 'budget-exhausted' }

  return { action: 'navigate', url: buildRushUrl(kind, path, origin) }
}

export function performRushRedirect(url: string): void {
  noteRedirect()
  // Full navigation: Angular must boot fresh on the registration page.
  window.location.href = url
}
