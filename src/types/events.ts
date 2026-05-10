export interface ApiRequestPayload {
  url: string
  method: string
  headers?: Record<string, string>
  body?: unknown
}

export interface ApiResponsePayload {
  url: string
  method: string
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface TokenAcquiredPayload {
  accessToken: string
  refreshToken: string
  expiresAt: number // Access token expiry — Unix timestamp in milliseconds
  refreshExpiresAt: number // Refresh token expiry — Unix timestamp in milliseconds (the real session lifetime)
}

export interface TokenExpiringPayload {
  expiresAt: number
  remainingMs: number
}

export interface PageChangedPayload {
  url: string
  path: string
}

export interface ModuleErrorPayload {
  moduleId: string
  error: unknown
}

export interface NpuEventMap {
  'api:request': ApiRequestPayload
  'api:response': ApiResponsePayload
  'token:acquired': TokenAcquiredPayload
  'token:expiring': TokenExpiringPayload
  'token:expired': Record<string, never>
  'page:changed': PageChangedPayload
  'module:error': ModuleErrorPayload
}

export type NpuEventName = keyof NpuEventMap
