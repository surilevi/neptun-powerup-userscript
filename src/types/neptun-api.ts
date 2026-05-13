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
 * Refresh behavior: Neptun's Angular app refreshes through Account/GetNewTokens
 *   and writes the new access_token + refresh_token_expiration to sessionStorage.
 *   NPU observes those writes and nudges Neptun's own idle service instead of
 *   calling the refresh endpoint directly.
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

/** Observed access token lifetime in seconds. */
export const ACCESS_TOKEN_LIFETIME_S = 300 // 5 minutes

/** Refresh access tokens when Neptun's own Angular interceptor would. */
export const ACCESS_REFRESH_BUFFER_S = 30

/** Refresh the rolling browser session when Neptun's own idle service would. */
export const SESSION_REFRESH_BUFFER_S = 150
