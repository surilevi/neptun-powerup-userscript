// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEventBus } from '../../src/core/event-bus'
import { createLogger } from '../../src/core/logger'
import { setupInterceptor, decodeJwt } from '../../src/core/interceptor'

// Helper: create a fake JWT with a given exp claim
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

describe('decodeJwt', () => {
  it('should decode a valid JWT payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 300
    const token = createFakeJwt(exp)
    const result = decodeJwt(token)

    expect(result).not.toBeNull()
    expect(result!.exp).toBe(exp)
    expect(result!.SessionId).toBe('test-session')
  })

  it('should return null for invalid tokens', () => {
    expect(decodeJwt('not-a-jwt')).toBeNull()
    expect(decodeJwt('')).toBeNull()
    expect(decodeJwt('a.b')).toBeNull()
  })

  it('should return null for malformed base64 payload', () => {
    expect(decodeJwt('header.!!!invalid!!!.signature')).toBeNull()
  })
})

describe('setupInterceptor', () => {
  let cleanup: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    cleanup = null
  })

  afterEach(() => {
    cleanup?.()
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('should emit token:acquired when a token is found in sessionStorage', () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on('token:acquired', handler)

    const exp = Math.floor(Date.now() / 1000) + 300
    sessionStorage.setItem('access_token', createFakeJwt(exp))

    cleanup = setupInterceptor(bus, createLogger('interceptor'))

    // Immediate check should have found the token
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: exp * 1000,
      }),
    )
  })

  it('should not emit if no token is in sessionStorage', () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on('token:acquired', handler)

    cleanup = setupInterceptor(bus, createLogger('interceptor'))

    expect(handler).not.toHaveBeenCalled()
  })

  it('should detect token changes on poll', () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on('token:acquired', handler)

    cleanup = setupInterceptor(bus, createLogger('interceptor'))
    expect(handler).not.toHaveBeenCalled()

    // Simulate Angular writing a token to sessionStorage
    const exp = Math.floor(Date.now() / 1000) + 300
    sessionStorage.setItem('access_token', createFakeJwt(exp))

    // Advance past one poll interval
    vi.advanceTimersByTime(2000)

    expect(handler).toHaveBeenCalledOnce()
  })

  it('should not re-emit for the same token', () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on('token:acquired', handler)

    const exp = Math.floor(Date.now() / 1000) + 300
    sessionStorage.setItem('access_token', createFakeJwt(exp))

    cleanup = setupInterceptor(bus, createLogger('interceptor'))

    // Advance through several poll cycles
    vi.advanceTimersByTime(10000)

    // Should only have been called once (initial detection)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('should emit again when the token changes', () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on('token:acquired', handler)

    const exp1 = Math.floor(Date.now() / 1000) + 300
    sessionStorage.setItem('access_token', createFakeJwt(exp1))

    cleanup = setupInterceptor(bus, createLogger('interceptor'))
    expect(handler).toHaveBeenCalledOnce()

    // Simulate a token refresh
    const exp2 = Math.floor(Date.now() / 1000) + 600
    sessionStorage.setItem('access_token', createFakeJwt(exp2))

    vi.advanceTimersByTime(2000)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expiresAt: exp2 * 1000,
      }),
    )
  })

  it('should stop polling after cleanup is called', () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on('token:acquired', handler)

    cleanup = setupInterceptor(bus, createLogger('interceptor'))
    cleanup()
    cleanup = null

    // Add a token after cleanup
    const exp = Math.floor(Date.now() / 1000) + 300
    sessionStorage.setItem('access_token', createFakeJwt(exp))

    vi.advanceTimersByTime(10000)

    expect(handler).not.toHaveBeenCalled()
  })
})
