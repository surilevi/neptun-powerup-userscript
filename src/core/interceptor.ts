import type { EventBus } from './event-bus'
import type { Logger } from './logger'
import { SESSION_STORAGE_KEYS } from '../types/neptun-api'
import type { JwtPayload } from '../types/neptun-api'

const POLL_INTERVAL_MS = 2000 // Check sessionStorage every 2 seconds

/**
 * Decodes a JWT token's payload without verification.
 * Returns null if the token is malformed.
 */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

/**
 * Monitors sessionStorage for access_token changes.
 *
 * The new Angular-based Neptun stores JWT tokens in sessionStorage.
 * Angular's own HttpClient interceptor handles 401 → refresh automatically
 * (POST GetNewTokens), writing the new access_token back to sessionStorage.
 *
 * This interceptor:
 * 1. Polls sessionStorage for changes to access_token
 * 2. Decodes the JWT to extract the `exp` claim
 * 3. Emits 'token:acquired' when a new/changed token is detected
 * 4. Emits 'token:expiring' when the token is near expiry
 * 5. Emits 'token:expired' when the token has expired
 *
 * We poll instead of using a storage event because the 'storage' event
 * only fires across tabs, not within the same tab where the write occurs.
 */
export function setupInterceptor(bus: EventBus, logger: Logger): () => void {
  let lastToken: string | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let storageInaccessible = false

  function readSessionStorage(key: string): string | null {
    try {
      return sessionStorage.getItem(key)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'SecurityError') {
        // Permanent — private browsing or cross-origin iframe
        if (!storageInaccessible) {
          storageInaccessible = true
          logger.warn('sessionStorage is inaccessible (private browsing?), stopping poll:', err)
          // Stop polling — no point spamming errors
          if (pollTimer !== null) {
            clearInterval(pollTimer)
            pollTimer = null
          }
        }
      } else {
        // Transient error — log but don't permanently disable
        logger.warn('sessionStorage access failed (transient):', err)
      }
      return null
    }
  }

  function checkToken(): void {
    if (storageInaccessible) return

    const token = readSessionStorage(SESSION_STORAGE_KEYS.accessToken)

    if (!token) {
      // Token was removed (logout)
      if (lastToken !== null) {
        lastToken = null
        logger.info(
          '[interceptor-debug] checkToken: access token removed from sessionStorage (logout?)',
        )
      }
      return
    }

    if (token === lastToken) return

    // New or changed token detected
    lastToken = token
    const parts = token.split('.')
    logger.info(`[interceptor-debug] checkToken: new token detected, parts=${parts.length}`)
    const jwt = decodeJwt(token)

    if (!jwt) {
      logger.warn(
        `[interceptor-debug] checkToken: decode failed for token with ${parts.length} parts`,
      )
      return
    }
    logger.info(`[interceptor-debug] checkToken: decoded JWT, exp=${jwt.exp}`)

    const expiresAt = jwt.exp * 1000 // Convert seconds to milliseconds

    // Validate exp is a finite number before emitting
    if (!Number.isFinite(expiresAt)) {
      logger.warn(`JWT exp claim is not a finite number (got ${jwt.exp}), skipping token`)
      return
    }

    const refreshExpiration = readSessionStorage(SESSION_STORAGE_KEYS.refreshTokenExpiration)

    // Parse refresh token expiry from ISO string to milliseconds
    let refreshExpiresAt = 0
    if (refreshExpiration) {
      const parsed = Date.parse(refreshExpiration)
      if (Number.isFinite(parsed)) {
        refreshExpiresAt = parsed
      } else {
        logger.warn(
          `[interceptor-debug] refresh_token_expiration is not a valid date: "${refreshExpiration}"`,
        )
      }
    }

    logger.info(
      `token detected, access expires at ${new Date(expiresAt).toISOString()}, refresh expires at ${refreshExpiresAt ? new Date(refreshExpiresAt).toISOString() : 'unknown'}`,
    )

    bus.emit('token:acquired', {
      accessToken: token,
      refreshToken: refreshExpiration ?? '',
      expiresAt,
      refreshExpiresAt,
    })
  }

  // Do an immediate check on setup
  checkToken()

  // Poll for changes (unless storage was already inaccessible)
  if (!storageInaccessible) {
    pollTimer = setInterval(checkToken, POLL_INTERVAL_MS)
    logger.info('sessionStorage token watcher started')
  }

  // Return cleanup function
  return () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    logger.info('sessionStorage token watcher stopped')
  }
}
