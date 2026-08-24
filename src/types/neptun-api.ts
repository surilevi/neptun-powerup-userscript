/**
 * Neptun REST API response shapes.
 * Confirmed via live access to neptun.bme.hu on 2026-03-21,
 * re-confirmed against Neptun 2026.2.9 (built 2026-08-10) on 2026-08-24.
 *
 * Token storage: sessionStorage
 *   - 'access_token': JWT string (5 min lifetime)
 *   - 'access_token_expiration_date': ISO 8601, tracks the JWT `exp` (2026.2.9+)
 *   - 'session_expiration_date': ISO 8601, rolling ~30 min window (2026.2.9+)
 *   - 'refresh_token_expiration': ISO 8601 rolling window (pre-2026.2.9 only)
 *   - 'login_type': 'web'
 *   - 'tabId': UUID (per-tab session tracking)
 *   - 'tid': opaque id added in 2026.2.9; unused by NPU
 *
 * 2026.2.9 split the single 'refresh_token_expiration' into a separate access
 * token expiry and session expiry. The session expiry is the one users see as
 * "Munkamenet lejárata" and the one worth counting down; the access token
 * refreshes silently underneath it. Both spellings are read so that portals
 * still on the older build keep working.
 *
 * JWT claims: SessionId, WebSessionType, jti, role, nbf, exp, iat, iss, aud
 *
 * Refresh behavior: Neptun's Angular app refreshes through Account/GetNewTokens
 *   and writes the new access_token + expiry keys to sessionStorage. NPU observes
 *   those writes and nudges Neptun's own idle service instead of calling the
 *   refresh endpoint directly.
 */

export interface NeptunSessionStorage {
  access_token: string
  /** 2026.2.9+; absent on older builds. */
  access_token_expiration_date?: string // ISO 8601
  /** 2026.2.9+; absent on older builds. */
  session_expiration_date?: string // ISO 8601
  /** Pre-2026.2.9 only; absent on current builds. */
  refresh_token_expiration?: string // ISO 8601
  login_type: 'web' | string
  tabId: string // UUID
}

export interface JwtPayload {
  SessionId: string
  WebSessionType: string
  jti: string
  role: string
  nbf: number
  exp: number
  iat: number
  iss: string
  aud: string
}

export const KNOWN_ENDPOINTS = {
  authenticate: 'Account/Authenticate',
  getNewTokens: 'Account/GetNewTokens',
  outerLogin: 'Account/OuterLogin',
  environmentData: 'General/EnvironmentData',
  unreadMessages: 'Message/GetUnreadedMessagesCount',
  upcomingEvents: 'Dashboard/GetUpcomingEvents',

  // Subject registration (confirmed 2026-03-22)
  schedulableSubjects: 'SubjectApplication/SchedulableSubjects',
  subjectCourses: 'SubjectApplication/GetSubjectsCourses',
  subjectSignin: 'SubjectApplication/SubjectSignin',
} as const

export const SESSION_STORAGE_KEYS = {
  accessToken: 'access_token',
  accessTokenExpiration: 'access_token_expiration_date',
  sessionExpiration: 'session_expiration_date',
  /** Pre-2026.2.9 spelling, still read as a fallback. */
  refreshTokenExpiration: 'refresh_token_expiration',
  loginType: 'login_type',
  tabId: 'tabId',
} as const

/**
 * Keys that carry the rolling session deadline, newest spelling first.
 *
 * The session window is what NPU counts down and what the keep-alive protects;
 * the access token expiry is deliberately not part of this list.
 */
export const SESSION_EXPIRATION_KEYS: readonly string[] = [
  SESSION_STORAGE_KEYS.sessionExpiration,
  SESSION_STORAGE_KEYS.refreshTokenExpiration,
] as const

/**
 * Read the session deadline as epoch milliseconds, tolerating either portal build.
 * Returns 0 when no key holds a parseable date, which callers treat as "unknown".
 */
export function readSessionExpiresAt(storage: Pick<Storage, 'getItem'>): number {
  for (const key of SESSION_EXPIRATION_KEYS) {
    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch {
      return 0
    }

    if (!raw) continue

    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed
  }

  return 0
}

/** Observed access token lifetime in seconds. */
export const ACCESS_TOKEN_LIFETIME_S = 300 // 5 minutes

/** Refresh access tokens when Neptun's own Angular interceptor would. */
export const ACCESS_REFRESH_BUFFER_S = 30

/** Refresh the rolling browser session when Neptun's own idle service would. */
export const SESSION_REFRESH_BUFFER_S = 150
