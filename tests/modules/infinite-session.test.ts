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

function mockRefreshResponse(expOffsetSeconds = 300, refreshOffsetMinutes = 30) {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds
  const refreshExpiration = new Date(Date.now() + refreshOffsetMinutes * 60_000).toISOString()

  return {
    ok: true,
    status: 200,
    text: vi.fn(async () =>
      JSON.stringify({
        access_token: createFakeJwt(exp),
        refresh_token_expiration: refreshExpiration,
      }),
    ),
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
    const fetchMock = vi.fn().mockResolvedValue(mockRefreshResponse())
    vi.stubGlobal('fetch', fetchMock)

    const existingExp = Math.floor(Date.now() / 1000) + 90
    sessionStorage.setItem('access_token', createFakeJwt(existingExp))
    sessionStorage.setItem(
      'refresh_token_expiration',
      new Date(Date.now() + 30 * 60_000).toISOString(),
    )

    await infiniteSessionModule.initialize(api)
    infiniteSessionModule.dispose?.()

    await infiniteSessionModule.initialize(api)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('Account/GetNewTokens')
  })

  it('should fire refresh request when token nears expiry', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const fetchMock = vi.fn().mockResolvedValue(mockRefreshResponse())
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    const expiresAt = Date.now() + 5 * 60 * 1000
    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    expect(fetchMock).toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][0]).toContain('Account/GetNewTokens')
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: '{}',
        headers: expect.objectContaining({
          Accept: 'application/json, text/plain, */*',
          Authorization: expect.stringMatching(/^Bearer\s.+/),
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('should persist refreshed tokens returned by the refresh endpoint', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const response = mockRefreshResponse(600, 35)
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    expect(sessionStorage.getItem('access_token')).toMatch(/\./)
    expect(sessionStorage.getItem('refresh_token_expiration')).toBeTruthy()
    expect(response.text).toHaveBeenCalledOnce()
  })

  it('should not fire refresh request when token is still fresh', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const fetchMock = vi.fn().mockResolvedValue(mockRefreshResponse())
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    vi.advanceTimersByTime(30_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should skip keepalive when one is already in flight', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 90 * 1000,
      refreshExpiresAt: 0,
    })

    vi.advanceTimersByTime(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should emit token:expiring before refresh request', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiringHandler = vi.fn()
    bus.on('token:expiring', expiringHandler)

    const fetchMock = vi.fn().mockResolvedValue(mockRefreshResponse())
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    const expiresAt = Date.now() + 5 * 60 * 1000
    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    expect(expiringHandler).toHaveBeenCalledWith(expect.objectContaining({ expiresAt }))
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
    const fetchMock = vi.fn().mockResolvedValue(mockRefreshResponse())
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'token-1',
      refreshToken: '',
      expiresAt: Date.now() + 10 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    vi.advanceTimersByTime(30_000)
    expect(fetchMock).not.toHaveBeenCalled()

    bus.emit('token:acquired', {
      accessToken: 'token-2',
      refreshToken: '',
      expiresAt: Date.now() + 2 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('should respect keepAliveInFlight in visibility change handler', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 90 * 1000,
      refreshExpiresAt: 0,
    })

    vi.advanceTimersByTime(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
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

    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
    vi.stubGlobal('fetch', fetchMock)

    await infiniteSessionModule.initialize(api)

    bus.emit('token:acquired', {
      accessToken: 'test-token',
      refreshToken: '',
      expiresAt: Date.now() + 5 * 60 * 1000,
      refreshExpiresAt: 0,
    })

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    expect(expiredHandler).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2)
  })

  it('should emit token:expired when refresh fails and token has expired', async () => {
    const bus = createEventBus()
    const api = createMockApi(bus)
    const expiredHandler = vi.fn()
    bus.on('token:expired', expiredHandler)

    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
    vi.stubGlobal('fetch', fetchMock)

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
})
