import { decodeJwt } from '../../core/interceptor'
import type { TokenAcquiredPayload } from '../../types/events'
import type { NpuModule, ModuleApi, PageContext } from '../../types/modules'
import { KNOWN_ENDPOINTS, REFRESH_BUFFER_S, SESSION_STORAGE_KEYS } from '../../types/neptun-api'

function getRefreshTokenRemaining(): number {
  try {
    const expStr = sessionStorage.getItem(SESSION_STORAGE_KEYS.refreshTokenExpiration)
    if (!expStr) return -1
    const expMs = Date.parse(expStr)
    if (!Number.isFinite(expMs)) return -1
    return expMs - Date.now()
  } catch {
    return -1
  }
}

const REFRESH_BUFFER_MS = REFRESH_BUFFER_S * 1000
const WATCHDOG_INTERVAL_MS = 15_000

let watchdogTimer: ReturnType<typeof setInterval> | null = null
let fallbackRetryTimer: ReturnType<typeof setTimeout> | null = null
let keepAliveInFlight = false
let activeAbortController: AbortController | null = null
let abortTimeoutId: ReturnType<typeof setTimeout> | null = null
let currentExpiresAt = 0
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

    const refreshExpiration = sessionStorage.getItem(SESSION_STORAGE_KEYS.refreshTokenExpiration)

    let refreshExpiresAt = 0
    if (refreshExpiration) {
      const parsed = Date.parse(refreshExpiration)
      if (Number.isFinite(parsed)) {
        refreshExpiresAt = parsed
      }
    }

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

function getApiPathPrefix(): string {
  const pathSegments = window.location.pathname.split('/')
  return pathSegments.length >= 2 ? `/${pathSegments[1]}` : ''
}

function persistRefreshedTokens(bodyText: string): boolean {
  if (!bodyText.trim()) return false

  try {
    const data = JSON.parse(bodyText) as {
      access_token?: string
      accessToken?: string
      refresh_token_expiration?: string
      refreshTokenExpiration?: string
    }

    const accessToken = data.access_token ?? data.accessToken
    const refreshTokenExpiration = data.refresh_token_expiration ?? data.refreshTokenExpiration

    if (!accessToken) return false

    sessionStorage.setItem(SESSION_STORAGE_KEYS.accessToken, accessToken)

    if (refreshTokenExpiration) {
      sessionStorage.setItem(SESSION_STORAGE_KEYS.refreshTokenExpiration, refreshTokenExpiration)
    }

    const jwt = decodeJwt(accessToken)
    if (jwt) {
      currentExpiresAt = jwt.exp * 1000
    }

    return true
  } catch (err) {
    api?.logger.warn('failed to parse refresh response JSON:', err)
    return false
  }
}

function stopWatchdog(): void {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  if (fallbackRetryTimer !== null) {
    clearTimeout(fallbackRetryTimer)
    fallbackRetryTimer = null
  }
}

function startWatchdog(): void {
  if (watchdogTimer !== null) return

  api?.logger.info('[session-debug] startWatchdog: starting 15s interval')

  watchdogTimer = setInterval(() => {
    if (!currentExpiresAt || !api) return
    if (keepAliveInFlight) return

    const remainingMs = currentExpiresAt - Date.now()
    api.logger.info(
      `[session-debug] watchdog tick: ${Math.round(remainingMs / 1000)}s remaining, buffer=${REFRESH_BUFFER_S}s`,
    )

    if (Date.now() >= currentExpiresAt - REFRESH_BUFFER_MS) {
      api.logger.info('[session-debug] watchdog tick: token is inside refresh buffer')
      triggerKeepAlive()
    } else {
      api.logger.info('[session-debug] watchdog tick: token still fresh, skipping refresh')
    }
  }, WATCHDOG_INTERVAL_MS)
}

function triggerKeepAlive(): void {
  if (!api) return
  if (keepAliveInFlight) return

  let accessToken: string | null
  try {
    accessToken = sessionStorage.getItem(SESSION_STORAGE_KEYS.accessToken)
  } catch {
    accessToken = null
  }

  if (!accessToken) {
    api.logger.warn('[session-debug] cannot refresh session: no access token in sessionStorage')
    return
  }

  keepAliveInFlight = true

  const remainingMs = Math.max(0, currentExpiresAt - Date.now())
  api.statusPanel.setSessionStatus('refreshing')
  api.bus.emit('token:expiring', {
    expiresAt: currentExpiresAt,
    remainingMs,
  })

  api.logger.info(
    `[session-debug] firing session refresh request with ${Math.round(remainingMs / 1000)}s left on access token`,
  )

  const refreshUrl = `${getApiPathPrefix()}/api/${KNOWN_ENDPOINTS.getNewTokens}`

  activeAbortController = new AbortController()
  abortTimeoutId = setTimeout(() => activeAbortController?.abort(), 10_000)

  fetch(refreshUrl, {
    method: 'POST',
    credentials: 'include',
    body: '{}',
    signal: activeAbortController.signal,
    headers: {
      Accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })
    .then(async (response) => {
      if (abortTimeoutId !== null) {
        clearTimeout(abortTimeoutId)
        abortTimeoutId = null
      }
      activeAbortController = null

      try {
        if (response.ok) {
          api?.logger.info('[session-debug] refresh request returned 200 OK')
          const bodyText = await response.text()
          const persisted = persistRefreshedTokens(bodyText)
          if (persisted) {
            api?.logger.info('session refresh succeeded')
          } else {
            api?.logger.warn('session refresh succeeded but returned no token payload')
          }
        } else if (response.status === 401 || response.status === 403) {
          api?.logger.warn(`[session-debug] refresh request returned auth error ${response.status}`)
          const refreshRemaining = getRefreshTokenRemaining()
          if (refreshRemaining > 0) {
            api?.logger.warn(
              `refresh endpoint was rejected while refresh token still looks valid (${Math.round(refreshRemaining / 1000)}s left)`,
            )
          } else {
            api?.logger.warn('session refresh was rejected and refresh token expired, session lost')
            api?.bus.emit('token:expired', {})
          }
        } else {
          api?.logger.warn(
            `[session-debug] refresh request returned unexpected status ${response.status}`,
          )
          api?.logger.warn(`session refresh returned unexpected status: ${response.status}`)
        }
      } finally {
        keepAliveInFlight = false
      }
    })
    .catch((err) => {
      if (abortTimeoutId !== null) {
        clearTimeout(abortTimeoutId)
        abortTimeoutId = null
      }
      activeAbortController = null
      keepAliveInFlight = false

      if (!api) return

      api.logger.warn('session refresh request failed:', err)

      if (Date.now() >= currentExpiresAt) {
        api.logger.warn('token has expired and session refresh failed, session lost')
        api.bus.emit('token:expired', {})
      } else {
        const remaining = currentExpiresAt - Date.now()
        if (remaining > 15_000) {
          api.logger.info('token still valid, scheduling 10s fallback retry')
          api.statusPanel.setSessionStatus('refreshing')
          if (fallbackRetryTimer !== null) clearTimeout(fallbackRetryTimer)
          fallbackRetryTimer = setTimeout(() => {
            fallbackRetryTimer = null
            triggerKeepAlive()
          }, 10_000)
        } else {
          api.logger.info(
            `token has only ${Math.round(remaining / 1000)}s left, watchdog will handle`,
          )
        }
      }
    })
}

function onTokenAcquired(payload: TokenAcquiredPayload): void {
  if (!Number.isFinite(payload.expiresAt)) {
    api?.logger.warn(`token:acquired expiresAt is not finite (${payload.expiresAt}), ignoring`)
    return
  }

  currentExpiresAt = payload.expiresAt
  api?.logger.info(
    `[session-debug] token acquired: access expires in ${Math.round((payload.expiresAt - Date.now()) / 1000)}s, refresh expires in ${payload.refreshExpiresAt ? Math.round((payload.refreshExpiresAt - Date.now()) / 1000) : 'unknown'}s`,
  )

  if (fallbackRetryTimer !== null) {
    clearTimeout(fallbackRetryTimer)
    fallbackRetryTimer = null
    api?.logger.info('[session-debug] cleared pending fallback retry after token update')
  }

  startWatchdog()
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

    const remaining = currentExpiresAt - Date.now()
    api.logger.info(
      `[session-debug] onVisibilityChange: tab visible, remaining=${Math.round(remaining / 1000)}s, buffer=${REFRESH_BUFFER_S}s`,
    )

    if (remaining <= REFRESH_BUFFER_MS) {
      api.logger.info(
        '[session-debug] onVisibilityChange: token near expiry, triggering keep-alive immediately',
      )
      triggerKeepAlive()
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
  description: 'Keeps the current Neptun session alive when possible',

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

    api.logger.info('initialized, waiting for token from sessionStorage watcher')
  },

  dispose(): void {
    stopWatchdog()
    activeAbortController?.abort()
    activeAbortController = null

    if (abortTimeoutId !== null) {
      clearTimeout(abortTimeoutId)
      abortTimeoutId = null
    }

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
    api = null
  },
}
