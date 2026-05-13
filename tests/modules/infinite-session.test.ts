// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../../src/core/event-bus'
import { createLogger } from '../../src/core/logger'
import { infiniteSessionModule } from '../../src/modules/infinite-session'
import type { ModuleApi, PageContext } from '../../src/types/modules'

function createMockApi(bus: ReturnType<typeof createEventBus>): ModuleApi {
  return {
    bus,
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      getForDomain: vi.fn(async () => undefined),
      setForDomain: vi.fn(async () => {}),
    },
    logger: createLogger('infinite-session'),
    statusPanel: {
      setSessionStatus: vi.fn(),
      addMessage: vi.fn(),
      setModuleContent: vi.fn(),
      setModuleContentElement: vi.fn(),
      expand: vi.fn(),
      collapse: vi.fn(),
      toggle: vi.fn(),
      isExpanded: vi.fn(() => false),
      getCourseRushMode: vi.fn(() => false),
      setCourseRushMode: vi.fn(),
      getExamRushMode: vi.fn(() => false),
      setExamRushMode: vi.fn(),
      getThemeSettings: vi.fn(() => ({ enabled: false, color: 'pink' })),
      setThemeSettings: vi.fn(),
      onThemeSettingsChange: vi.fn(() => () => {}),
      dispose: vi.fn(),
    },
  }
}

function createFakeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(
    JSON.stringify({
      SessionId: 'test-session',
      WebSessionType: 'Student',
      jti: 'test-jti',
      role: 'Student',
      nbf: Math.floor(Date.now() / 1000),
      exp,
      iat: Math.floor(Date.now() / 1000),
      iss: 'Neptun',
      aud: 'NeptunWeb',
    }),
  )
  const signature = btoa('fake-signature')
  return `${header}.${payload}.${signature}`
}

function mockNativeRefresh(expOffsetSeconds = 300, refreshOffsetMinutes = 30) {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds
  const refreshExpiration = new Date(Date.now() + refreshOffsetMinutes * 60_000).toISOString()
  const refreshAction = vi.fn()
  let refreshed = false

  const listener = () => {
    refreshAction()
    if (refreshed) return
    refreshed = true
    sessionStorage.setItem('access_token', createFakeJwt(exp))
    sessionStorage.setItem('refresh_token_expiration', refreshExpiration)
  }

  document.addEventListener('visibilitychange', listener)
  document.addEventListener('mousedown', listener)

  return {
    refreshAction,
    refreshExpiration,
    dispose: () => {
      document.removeEventListener('visibilitychange', listener)
      document.removeEventListener('mousedown', listener)
    },
  }
}

describe('infiniteSessionModule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.history.replaceState({}, '', '/hallgato_ng/dashboard')
    sessionStorage.clear()
    sessionStorage.setItem('access_token', createFakeJwt(Math.floor(Date.now() / 1000) + 300))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    infiniteSessionModule.dispose?.()
    sessionStorage.clear()
    vi.useRealTimers()
  })

  it('should activate on any page', () => {
    const context: PageContext = {
      url: 'https://example.hu/hallgato_ng/login',
      domain: 'example.hu',
      path: '/hallgato_ng/login',
    }
    expect(infiniteSessionModule.shouldActivate(context)).toBe(true)
  })

  it('should start watchdog when token:acquired fires', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: Date.now() + 10 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1)
  })

  it('should recover an existing token from sessionStorage after module reinitialize', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const nativeRefresh = mockNativeRefresh(300, 35)

    const existingExp = Math.floor(Date.now() / 1000) + 45
    sessionStorage.setItem('access_token', createFakeJwt(existingExp))
    sessionStorage.setItem('refresh_token_expiration', new Date(Date.now() + 120_000).toISOString())

    await infiniteSessionModule.initialize(api)
    infiniteSessionModule.dispose?.()

    await infiniteSessionModule.initialize(api)
    await vi.advanceTimersByTimeAsync(21_000)

    expect(nativeRefresh.refreshAction).toHaveBeenCalled()
    expect(sessionStorage.getItem('refresh_token_expiration')).toBe(nativeRefresh.refreshExpiration)

    nativeRefresh.dispose()
  })

  it('should request Neptun native refresh when session nears expiry', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const nativeRefresh = mockNativeRefresh(300, 35)
    const refreshExpiresAt = Date.now() + 120_000
    sessionStorage.setItem('refresh_token_expiration', new Date(refreshExpiresAt).toISOString())

    await infiniteSessionModule.initialize(api)

    const expiresAt = Date.now() + 5 * 60 * 1000
    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt,
      refreshExpiresAt,
    })

    await vi.advanceTimersByTimeAsync(21_000)

    expect(nativeRefresh.refreshAction).toHaveBeenCalled()
    expect(sessionStorage.getItem('refresh_token_expiration')).toBe(nativeRefresh.refreshExpiration)

    nativeRefresh.dispose()
  })

  it('should adopt tokens written by Neptun native refresh', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const nativeRefresh = mockNativeRefresh(600, 35)
    const refreshExpiresAt = Date.now() + 120_000
    sessionStorage.setItem('refresh_token_expiration', new Date(refreshExpiresAt).toISOString())

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt,
    })

    await vi.advanceTimersByTimeAsync(21_000)

    expect(sessionStorage.getItem('access_token')).toMatch(/\./)
    expect(sessionStorage.getItem('refresh_token_expiration')).toBe(nativeRefresh.refreshExpiration)

    nativeRefresh.dispose()
  })

  it('should not fire refresh request when token is still fresh', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const nativeSignal = vi.fn()
    document.addEventListener('mousedown', nativeSignal)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    vi.advanceTimersByTime(30_000)

    expect(nativeSignal).not.toHaveBeenCalled()
    document.removeEventListener('mousedown', nativeSignal)
  })

  it('should send a periodic native activity pulse', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const nativeSignal = vi.fn()
    document.addEventListener('mousedown', nativeSignal)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 30 * 60 * 1000,
      refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    })

    await vi.advanceTimersByTimeAsync(4 * 60_000 - 1)
    expect(nativeSignal).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(nativeSignal).toHaveBeenCalledTimes(1)

    document.removeEventListener('mousedown', nativeSignal)
  })

  it('should warn that registration rush keep-alive is best-effort', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    window.history.replaceState({}, '', '/hallgatoi/subjects/registration')

    await infiniteSessionModule.initialize(api)

    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('best-effort'),
    )
  })

  it('should emit expired and skip native activity when the stored token disappears', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiredHandler = vi.fn()
    const nativeSignal = vi.fn()
    bus.on('token:expired', expiredHandler)
    document.addEventListener('mousedown', nativeSignal)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 30 * 60 * 1000,
      refreshExpiresAt: Date.now() + 30 * 60 * 1000,
    })
    sessionStorage.removeItem('access_token')

    await vi.advanceTimersByTimeAsync(15_000)
    expect(expiredHandler).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(nativeSignal).not.toHaveBeenCalled()

    document.removeEventListener('mousedown', nativeSignal)
  })

  it('should skip keepalive when one is already in flight', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const refreshExpiresAt = Date.now() + 120_000
    sessionStorage.setItem('refresh_token_expiration', new Date(refreshExpiresAt).toISOString())

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt,
    })

    vi.advanceTimersByTime(15_000)
    expect(api.statusPanel.setSessionStatus).toHaveBeenCalledWith('refreshing')
    const refreshingCalls = () =>
      vi
        .mocked(api.statusPanel.setSessionStatus)
        .mock.calls.filter(([state]) => state === 'refreshing').length
    expect(refreshingCalls()).toBe(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(refreshingCalls()).toBe(1)
  })

  it('should emit token:expiring before refresh request', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiringHandler = vi.fn()
    bus.on('token:expiring', expiringHandler)
    const nativeRefresh = mockNativeRefresh()
    const refreshExpiresAt = Date.now() + 120_000
    sessionStorage.setItem('refresh_token_expiration', new Date(refreshExpiresAt).toISOString())

    await infiniteSessionModule.initialize(api)

    const expiresAt = Date.now() + 5 * 60 * 1000
    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt,
      refreshExpiresAt,
    })

    await vi.advanceTimersByTimeAsync(15_000)

    expect(expiringHandler).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: refreshExpiresAt }),
    )

    nativeRefresh.dispose()
  })

  it('should keep a single watchdog on new token', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 10 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    const countAfterFirst = vi.getTimerCount()
    expect(countAfterFirst).toBeGreaterThanOrEqual(1)

    bus.emit('token:acquired', {
      accessToken: 'token-2',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 10 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    expect(vi.getTimerCount()).toBe(countAfterFirst)
  })

  it('should use new expiry after second token:acquired', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const nativeRefresh = mockNativeRefresh()

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'token-1',
      refreshToken: '',
      expiresAt: Date.now() + 10 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    vi.advanceTimersByTime(30_000)
    expect(nativeRefresh.refreshAction).not.toHaveBeenCalled()

    bus.emit('token:acquired', {
      accessToken: 'token-2',
      refreshToken: '',
      expiresAt: Date.now() + 2 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(90_000)
    expect(nativeRefresh.refreshAction).toHaveBeenCalled()
    nativeRefresh.dispose()
  })

  it('should respect keepAliveInFlight in visibility change handler', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 90 * 1000,
      refreshExpiresAt: 0,
    })

    vi.advanceTimersByTime(60_000)
    expect(api.statusPanel.setSessionStatus).toHaveBeenCalledWith('refreshing')
    const refreshingCalls = () =>
      vi
        .mocked(api.statusPanel.setSessionStatus)
        .mock.calls.filter(([state]) => state === 'refreshing').length
    expect(refreshingCalls()).toBe(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(refreshingCalls()).toBe(1)
  })

  it('should dismiss accented Hungarian session timeout dialogs', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)

    await infiniteSessionModule.initialize(api)

    const overlay = document.createElement('div')
    overlay.className = 'cdk-overlay-container'
    overlay.innerHTML = `
      <div class="mat-mdc-dialog-container">
        <p>A munkamenet hamarosan lejár. Kéri a meghosszabbítást?</p>
        <button type="button">Meghosszabbít</button>
      </div>
    `
    document.body.appendChild(overlay)

    await Promise.resolve()

    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'info',
      'Session timeout dialog dismissed',
    )
  })

  it('should stop watchdog on dispose', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test',
      refreshToken: 'test',
      expiresAt: Date.now() + 10 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    const timersBeforeDispose = vi.getTimerCount()
    expect(timersBeforeDispose).toBeGreaterThanOrEqual(1)

    infiniteSessionModule.dispose?.()

    expect(vi.getTimerCount()).toBeLessThan(timersBeforeDispose)
  })

  it('should schedule fallback retry on failure when token still valid', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiredHandler = vi.fn()
    bus.on('token:expired', expiredHandler)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 36_000)

    expect(expiredHandler).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2)
  })

  it('should emit token:expired when refresh fails and token has expired', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiredHandler = vi.fn()
    bus.on('token:expired', expiredHandler)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 2 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(1 * 60 * 1000)
    expect(expiredHandler).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(expiredHandler).toHaveBeenCalled()
  })

  it('should not refresh access token alone when session expiry is still valid', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiredHandler = vi.fn()
    bus.on('token:expired', expiredHandler)
    const nativeSignal = vi.fn()
    document.addEventListener('mousedown', nativeSignal)

    sessionStorage.setItem(
      'refresh_token_expiration',
      new Date(Date.now() + 30 * 60_000).toISOString(),
    )

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 10 * 1000,
      refreshExpiresAt: Date.now() + 30 * 60_000,
    })

    await vi.advanceTimersByTimeAsync(15_000)

    expect(nativeSignal).not.toHaveBeenCalled()
    expect(expiredHandler).not.toHaveBeenCalled()
    document.removeEventListener('mousedown', nativeSignal)
  })

  it('should emit token:expired when refresh session is expired even if access token is fresh', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiredHandler = vi.fn()
    bus.on('token:expired', expiredHandler)
    const nativeSignal = vi.fn()
    document.addEventListener('mousedown', nativeSignal)

    const expiredRefreshAt = Date.now() - 1000
    sessionStorage.setItem('refresh_token_expiration', new Date(expiredRefreshAt).toISOString())

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt: expiredRefreshAt,
    })

    await vi.advanceTimersByTimeAsync(15_000)

    expect(expiredHandler).toHaveBeenCalledTimes(1)
    expect(nativeSignal).not.toHaveBeenCalled()
    document.removeEventListener('mousedown', nativeSignal)
  })

  it('should emit token:acquired after native refresh writes tokens', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const acquiredHandler = vi.fn()
    bus.on('token:acquired', acquiredHandler)
    const nativeRefresh = mockNativeRefresh(600, 35)
    const refreshExpiresAt = Date.now() + 120_000
    sessionStorage.setItem('refresh_token_expiration', new Date(refreshExpiresAt).toISOString())

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt,
    })

    await vi.advanceTimersByTimeAsync(21_000)

    expect(acquiredHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: expect.stringMatching(/\./),
        refreshExpiresAt: Date.parse(nativeRefresh.refreshExpiration),
      }),
    )
    nativeRefresh.dispose()
  })

  it('should not emit duplicate token:acquired when the token watcher observes native refresh first', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const acquiredHandler = vi.fn()
    bus.on('token:acquired', acquiredHandler)
    const nativeRefresh = mockNativeRefresh(600, 35)
    const refreshExpiresAt = Date.now() + 120_000
    sessionStorage.setItem('refresh_token_expiration', new Date(refreshExpiresAt).toISOString())

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt,
    })

    await vi.advanceTimersByTimeAsync(15_000)

    const refreshedAccessToken = sessionStorage.getItem('access_token')
    expect(refreshedAccessToken).toMatch(/\./)

    bus.emit('token:acquired', {
      accessToken: refreshedAccessToken!,
      refreshToken: nativeRefresh.refreshExpiration,
      expiresAt: Date.now() + 10 * 60 * 1000,
      refreshExpiresAt: Date.parse(nativeRefresh.refreshExpiration),
    })

    await vi.advanceTimersByTimeAsync(6_000)

    expect(acquiredHandler).toHaveBeenCalledTimes(2)
    nativeRefresh.dispose()
  })
})
