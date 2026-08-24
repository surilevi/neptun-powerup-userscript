import { decodeJwt } from '../../core/interceptor'
import type { TokenAcquiredPayload } from '../../types/events'
import type { NpuModule, ModuleApi, PageContext } from '../../types/modules'
import {
  ACCESS_REFRESH_BUFFER_S,
  SESSION_EXPIRATION_KEYS,
  SESSION_REFRESH_BUFFER_S,
  SESSION_STORAGE_KEYS,
  readSessionExpiresAt,
} from '../../types/neptun-api'

type RefreshReason = 'access-token' | 'session-timeout'

interface RefreshDecision {
  shouldRefresh: boolean
  reason: RefreshReason | null
  accessRemainingMs: number
  sessionRemainingMs: number
}

function getStoredRefreshExpiresAt(): number {
  try {
    return readSessionExpiresAt(sessionStorage)
  } catch {
    return 0
  }
}

/** The raw session deadline string, whichever build's key currently holds it. */
function readStoredSessionExpirationRaw(): string | null {
  for (const key of SESSION_EXPIRATION_KEYS) {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) return raw
    } catch {
      return null
    }
  }

  return null
}

function formatRemaining(ms: number): string {
  return Number.isFinite(ms) && ms >= 0 ? `${Math.round(ms / 1000)}s` : 'unknown'
}

const ACCESS_REFRESH_BUFFER_MS = ACCESS_REFRESH_BUFFER_S * 1000
const SESSION_REFRESH_BUFFER_MS = SESSION_REFRESH_BUFFER_S * 1000
const WATCHDOG_INTERVAL_MS = 15_000
const ACTIVITY_PULSE_INTERVAL_MS = 4 * 60_000
const NATIVE_REFRESH_SETTLE_MS = 6_000
const FALLBACK_RETRY_MS = 10_000

let watchdogTimer: ReturnType<typeof setInterval> | null = null
let activityPulseTimer: ReturnType<typeof setInterval> | null = null
let fallbackRetryTimer: ReturnType<typeof setTimeout> | null = null
let nativeRefreshSettleTimer: ReturnType<typeof setTimeout> | null = null
let keepAliveInFlight = false
let currentExpiresAt = 0
let currentRefreshExpiresAt = 0
let sessionExpiredEmitted = false
let api: ModuleApi | null = null
let unsubscribe: (() => void) | null = null
let visibilityHandler: (() => void) | null = null
let sessionModalObserver: MutationObserver | null = null

function normalizeMatchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function getExistingTokenPayload(): TokenAcquiredPayload | null {
  try {
    const accessToken = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
    if (!accessToken) return null

    const jwt = decodeJwt(accessToken)
    if (!jwt) return null

    const expiresAt = jwt.exp * 1000
    if (!Number.isFinite(expiresAt)) return null

    const refreshExpiration = readStoredSessionExpirationRaw()
    const refreshExpiresAt = readSessionExpiresAt(sessionStorage)

    return {
      accessToken,
      refreshToken: refreshExpiration ?? '',
      expiresAt,
      refreshExpiresAt,
    }
  } catch {
    return null
  }
}

function getRefreshExpiresAt(): number {
  const storedRefreshExpiresAt = getStoredRefreshExpiresAt()
  if (storedRefreshExpiresAt > 0) {
    currentRefreshExpiresAt = storedRefreshExpiresAt
  }
  return currentRefreshExpiresAt
}

function getSessionRemaining(): number {
  const refreshExpiresAt = getRefreshExpiresAt()
  return refreshExpiresAt > 0 ? refreshExpiresAt - Date.now() : -1
}

function getRefreshDecision(now = Date.now()): RefreshDecision {
  const accessRemainingMs = currentExpiresAt > 0 ? currentExpiresAt - now : -1
  const refreshExpiresAt = getRefreshExpiresAt()
  const sessionRemainingMs = refreshExpiresAt > 0 ? refreshExpiresAt - now : -1

  if (sessionRemainingMs >= 0) {
    if (sessionRemainingMs <= SESSION_REFRESH_BUFFER_MS) {
      return {
        shouldRefresh: true,
        reason: 'session-timeout',
        accessRemainingMs,
        sessionRemainingMs,
      }
    }

    return {
      shouldRefresh: false,
      reason: null,
      accessRemainingMs,
      sessionRemainingMs,
    }
  }

  if (currentExpiresAt > 0 && accessRemainingMs <= ACCESS_REFRESH_BUFFER_MS) {
    return {
      shouldRefresh: true,
      reason: 'access-token',
      accessRemainingMs,
      sessionRemainingMs,
    }
  }

  return {
    shouldRefresh: false,
    reason: null,
    accessRemainingMs,
    sessionRemainingMs,
  }
}

function restoreSessionStatusAfterRefreshFailure(): void {
  if (!api) return

  const sessionRemaining = getSessionRemaining()
  if (sessionRemaining > 0) {
    api.statusPanel.setSessionStatus(
      sessionRemaining <= SESSION_REFRESH_BUFFER_MS ? 'expiring' : 'active',
      sessionRemaining,
    )
    return
  }

  const accessRemaining = currentExpiresAt - Date.now()
  if (currentRefreshExpiresAt <= 0 && accessRemaining > 0) {
    api.statusPanel.setSessionStatus(
      accessRemaining <= ACCESS_REFRESH_BUFFER_MS ? 'expiring' : 'active',
      accessRemaining,
    )
    return
  }

  emitTokenExpired()
}

function emitTokenExpired(): void {
  if (sessionExpiredEmitted) return
  sessionExpiredEmitted = true
  api?.bus.emit('token:expired', {})
}

function getStoredAccessToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
  } catch {
    return null
  }
}

function hasStoredAccessToken(): boolean {
  if (getStoredAccessToken()) return true
  if (!sessionExpiredEmitted) {
    api?.logger.warn('[session-debug] access token missing from sessionStorage, session lost')
  }
  emitTokenExpired()
  return false
}

function dispatchNeptunActivityEvent(): void {
  const target =
    document.querySelector('.footer__version') ??
    document.querySelector('app-footer') ??
    document.body ??
    document.documentElement ??
    document

  const activityEvent =
    typeof window.MouseEvent === 'function'
      ? new window.MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
        })
      : new window.Event('mousedown', { bubbles: true, cancelable: true })

  target.dispatchEvent(activityEvent)
}

function requestNeptunNativeRefresh(): void {
  if (document.visibilityState === 'visible') {
    try {
      const visibilityEvent =
        typeof window.Event === 'function'
          ? new window.Event('visibilitychange')
          : new Event('visibilitychange')
      document.dispatchEvent(visibilityEvent)
    } catch (err) {
      api?.logger.warn('[session-debug] failed to dispatch Neptun visibility refresh:', err)
    }
  }

  try {
    dispatchNeptunActivityEvent()
  } catch (err) {
    api?.logger.warn('[session-debug] failed to dispatch Neptun activity refresh:', err)
  }
}

function stopWatchdog(): void {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  if (activityPulseTimer !== null) {
    clearInterval(activityPulseTimer)
    activityPulseTimer = null
  }
  if (fallbackRetryTimer !== null) {
    clearTimeout(fallbackRetryTimer)
    fallbackRetryTimer = null
  }
  if (nativeRefreshSettleTimer !== null) {
    clearTimeout(nativeRefreshSettleTimer)
    nativeRefreshSettleTimer = null
  }
}

function startWatchdog(): void {
  if (watchdogTimer !== null) return

  api?.logger.info('[session-debug] startWatchdog: starting 15s interval')

  watchdogTimer = setInterval(() => {
    if (!currentExpiresAt || !api) return
    if (keepAliveInFlight) return
    if (!hasStoredAccessToken()) return

    const decision = getRefreshDecision()
    api.logger.info(
      `[session-debug] watchdog tick: access=${formatRemaining(decision.accessRemainingMs)}, session=${formatRemaining(decision.sessionRemainingMs)}, accessBuffer=${ACCESS_REFRESH_BUFFER_S}s, sessionBuffer=${SESSION_REFRESH_BUFFER_S}s`,
    )

    if (currentRefreshExpiresAt > 0 && decision.sessionRemainingMs <= 0) {
      api.logger.warn('[session-debug] refresh token expired, session lost')
      emitTokenExpired()
      return
    }

    if (decision.shouldRefresh && decision.reason) {
      api.logger.info(`[session-debug] watchdog tick: ${decision.reason} is inside refresh buffer`)
      triggerKeepAlive(decision.reason)
    } else {
      api.logger.info('[session-debug] watchdog tick: token still fresh, skipping refresh')
    }
  }, WATCHDOG_INTERVAL_MS)
}

function startActivityPulse(): void {
  if (activityPulseTimer !== null) return

  api?.logger.info('[session-debug] startActivityPulse: starting 4m native activity interval')

  activityPulseTimer = setInterval(() => {
    if (!currentExpiresAt || !api) return
    if (keepAliveInFlight) return
    if (!hasStoredAccessToken()) return

    const decision = getRefreshDecision()
    if (currentRefreshExpiresAt > 0 && decision.sessionRemainingMs <= 0) {
      api.logger.warn('[session-debug] activity pulse skipped because refresh token is expired')
      emitTokenExpired()
      return
    }

    api.logger.info(
      `[session-debug] activity pulse: access=${formatRemaining(decision.accessRemainingMs)}, session=${formatRemaining(decision.sessionRemainingMs)}`,
    )
    requestNeptunNativeRefresh()
  }, ACTIVITY_PULSE_INTERVAL_MS)
}

function warnRegistrationRushLimit(): void {
  const path = window.location.pathname.toLowerCase()
  if (!path.includes('/subjects/registration') && !path.includes('/exams/overview/registration')) {
    return
  }

  api?.statusPanel.addMessage(
    'warn',
    'Session keep-alive is best-effort; Neptun may still force logout during registration rushes.',
  )
}

function triggerKeepAlive(reason: RefreshReason = 'access-token'): void {
  if (!api) return
  if (keepAliveInFlight) return

  const previousAccessToken = getStoredAccessToken()
  if (!previousAccessToken) {
    api.logger.warn('[session-debug] cannot refresh session: no access token in sessionStorage')
    emitTokenExpired()
    return
  }
  const previousRefreshExpiresAt = getRefreshExpiresAt()

  keepAliveInFlight = true

  const accessRemainingMs = Math.max(0, currentExpiresAt - Date.now())
  const sessionRemainingMs = getSessionRemaining()
  const visibleRemainingMs = sessionRemainingMs >= 0 ? sessionRemainingMs : accessRemainingMs
  api.bus.emit('token:expiring', {
    expiresAt: currentRefreshExpiresAt || currentExpiresAt,
    remainingMs: visibleRemainingMs,
  })
  api.statusPanel.setSessionStatus('refreshing')

  api.logger.info(
    `[session-debug] requesting native Neptun refresh (${reason}) with access=${formatRemaining(accessRemainingMs)}, session=${formatRemaining(sessionRemainingMs)}`,
  )

  requestNeptunNativeRefresh()

  nativeRefreshSettleTimer = setTimeout(() => {
    nativeRefreshSettleTimer = null
    const payload = getExistingTokenPayload()
    const latestAccessToken = getStoredAccessToken()
    const latestRefreshExpiresAt = getRefreshExpiresAt()

    if (
      payload &&
      (latestAccessToken !== previousAccessToken ||
        latestRefreshExpiresAt > previousRefreshExpiresAt)
    ) {
      keepAliveInFlight = false
      api?.logger.info('[session-debug] native Neptun refresh succeeded')
      api?.bus.emit('token:acquired', payload)
      return
    }

    keepAliveInFlight = false

    if (!api) return

    api.logger.warn('[session-debug] native Neptun refresh did not update stored tokens')

    const sessionRemaining = getSessionRemaining()
    const accessRemaining = currentExpiresAt - Date.now()
    const retryWindowRemaining = sessionRemaining > 0 ? sessionRemaining : accessRemaining

    if (currentRefreshExpiresAt > 0 && sessionRemaining <= 0) {
      api.logger.warn('refresh token expired and native session refresh failed, session lost')
      emitTokenExpired()
    } else if (currentRefreshExpiresAt <= 0 && accessRemaining <= 0) {
      api.logger.warn('token has expired and native session refresh failed, session lost')
      emitTokenExpired()
    } else {
      restoreSessionStatusAfterRefreshFailure()
      if (retryWindowRemaining > 15_000) {
        api.logger.info('session still valid, scheduling native refresh retry')
        if (fallbackRetryTimer !== null) clearTimeout(fallbackRetryTimer)
        fallbackRetryTimer = setTimeout(() => {
          fallbackRetryTimer = null
          triggerKeepAlive(reason)
        }, FALLBACK_RETRY_MS)
      } else {
        api.logger.info(
          `refresh window has only ${Math.round(retryWindowRemaining / 1000)}s left, watchdog will handle`,
        )
      }
    }
  }, NATIVE_REFRESH_SETTLE_MS)
}

function onTokenAcquired(payload: TokenAcquiredPayload): void {
  if (!Number.isFinite(payload.expiresAt)) {
    api?.logger.warn(`token:acquired expiresAt is not finite (${payload.expiresAt}), ignoring`)
    return
  }

  currentExpiresAt = payload.expiresAt
  currentRefreshExpiresAt =
    payload.refreshExpiresAt || getStoredRefreshExpiresAt() || currentRefreshExpiresAt
  sessionExpiredEmitted = false
  api?.logger.info(
    `[session-debug] token acquired: access expires in ${Math.round((payload.expiresAt - Date.now()) / 1000)}s, refresh expires in ${payload.refreshExpiresAt ? Math.round((payload.refreshExpiresAt - Date.now()) / 1000) : 'unknown'}s`,
  )

  if (fallbackRetryTimer !== null) {
    clearTimeout(fallbackRetryTimer)
    fallbackRetryTimer = null
    api?.logger.info('[session-debug] cleared pending fallback retry after token update')
  }

  if (keepAliveInFlight && nativeRefreshSettleTimer !== null) {
    clearTimeout(nativeRefreshSettleTimer)
    nativeRefreshSettleTimer = null
    keepAliveInFlight = false
    api?.logger.info('[session-debug] native refresh observed by token watcher')
  }

  startWatchdog()
  startActivityPulse()
}

function hydrateFromSessionStorage(): void {
  const payload = getExistingTokenPayload()
  if (!payload) {
    api?.logger.info('[session-debug] initialize: no existing token found in sessionStorage')
    return
  }

  api?.logger.info(
    `[session-debug] initialize: recovered existing token with ${Math.round((payload.expiresAt - Date.now()) / 1000)}s remaining`,
  )
  onTokenAcquired(payload)
}

function onVisibilityChange(): void {
  try {
    api?.logger.info(`[session-debug] onVisibilityChange: state="${document.visibilityState}"`)
    if (document.visibilityState !== 'visible') return
    if (!currentExpiresAt || !api) return
    if (keepAliveInFlight) return

    const decision = getRefreshDecision()
    api.logger.info(
      `[session-debug] onVisibilityChange: tab visible, access=${formatRemaining(decision.accessRemainingMs)}, session=${formatRemaining(decision.sessionRemainingMs)}, accessBuffer=${ACCESS_REFRESH_BUFFER_S}s, sessionBuffer=${SESSION_REFRESH_BUFFER_S}s`,
    )

    if (decision.shouldRefresh && decision.reason) {
      api.logger.info(
        `[session-debug] onVisibilityChange: ${decision.reason} near expiry, triggering keep-alive immediately`,
      )
      triggerKeepAlive(decision.reason)
    }
  } catch (err) {
    api?.logger.error('error in visibility change handler:', err)
  }
}

function suppressSessionTimeoutModals(): void {
  sessionModalObserver?.disconnect()

  sessionModalObserver = new MutationObserver(() => {
    const overlayButtons = document.querySelectorAll(
      '.cdk-overlay-container button, .mat-mdc-dialog-container button',
    )

    for (const btn of Array.from(overlayButtons)) {
      const rawText = (btn.textContent ?? '').trim()
      const text = normalizeMatchText(rawText)
      const dialogText = normalizeMatchText(
        btn.closest('.cdk-overlay-pane, .mat-mdc-dialog-container')?.textContent ?? '',
      )

      const isSessionDialog =
        (dialogText.includes('session') || dialogText.includes('munkamenet')) &&
        (dialogText.includes('lejar') ||
          dialogText.includes('expir') ||
          dialogText.includes('timeout') ||
          dialogText.includes('idotullepes') ||
          dialogText.includes('kijelentkezes') ||
          /\d+\s*(perc|sec|mp|masodperc)/.test(dialogText))

      const isExtendButton =
        text === 'ok' ||
        text === 'igen' ||
        text.includes('extend') ||
        text.includes('meghosszabbit') ||
        text.includes('folytat') ||
        text.includes('marad')

      if (isSessionDialog && isExtendButton) {
        api?.logger.info(`[session-debug] suppressing session timeout modal, clicking: ${rawText}`)
        api?.statusPanel.addMessage('info', 'Session timeout dialog dismissed')
        ;(btn as HTMLElement).click()
        return
      }
    }
  })

  sessionModalObserver.observe(document.body, { childList: true, subtree: true })
}

export const infiniteSessionModule: NpuModule = {
  id: 'infinite-session',
  name: 'Infinite Session',
  description:
    'Best-effort session keep-alive for normal use; Neptun can still force logout during registration rushes',

  shouldActivate(_context: PageContext): boolean {
    return true
  },

  initialize(moduleApi: ModuleApi): void {
    api = moduleApi
    unsubscribe = api.bus.on('token:acquired', onTokenAcquired)

    visibilityHandler = onVisibilityChange
    document.addEventListener('visibilitychange', visibilityHandler)

    suppressSessionTimeoutModals()
    hydrateFromSessionStorage()
    warnRegistrationRushLimit()

    api.logger.info('initialized, waiting for token from sessionStorage watcher')
  },

  dispose(): void {
    stopWatchdog()
    keepAliveInFlight = false
    unsubscribe?.()
    unsubscribe = null
    sessionModalObserver?.disconnect()
    sessionModalObserver = null

    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }

    currentExpiresAt = 0
    currentRefreshExpiresAt = 0
    sessionExpiredEmitted = false
    api = null
  },
}
