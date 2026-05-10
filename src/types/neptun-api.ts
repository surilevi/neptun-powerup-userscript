/**
 * Neptun REST API response shapes.
 * Confirmed via live access to neptun.bme.hu on 2026-03-21.
 *
 * Token storage: sessionStorage
 *   - 'access_token': JWT string (5 min lifetime)
 *   - 'refresh_token_expiration': ISO 8601 string (rolling 30 min window)
 *   - 'login_type': 'web'
 *   - 'tabId': UUID (per-tab session tracking)
 *
 * JWT claims: SessionId, WebSessionType, jti, role, nbf, exp, iat, iss, aud
 *
 * Refresh behavior: Reactive on 401 → POST GetNewTokens → new access_token
 *   + extended refresh_token_expiration written to sessionStorage.
 *   Each successful refresh extends the refresh window by ~5 min (rolling).
 */

export interface NeptunSessionStorage {
  access_token: string
  refresh_token_expiration: string // ISO 8601
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
  refreshTokenExpiration: 'refresh_token_expiration',
  loginType: 'login_type',
  tabId: 'tabId',
} as const

/** Access token lifetime in seconds */
export const ACCESS_TOKEN_LIFETIME_S = 300 // 5 minutes

/** Refresh before expiry by this many seconds */
export const REFRESH_BUFFER_S = 180 // refresh 3 min before expiry for safer tab-throttled keepalive
