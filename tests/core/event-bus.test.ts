import { describe, it, expect, vi } from 'vitest'
import { createEventBus } from '../../src/core/event-bus'

describe('EventBus', () => {
  it('should call subscriber when event is emitted', () => {
    const bus = createEventBus()
    const handler = vi.fn()

    bus.on('token:expired', handler)
    bus.emit('token:expired', {})

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({})
  })

  it('should pass correct payload to subscriber', () => {
    const bus = createEventBus()
    const handler = vi.fn()
    const payload = {
      accessToken: 'abc',
      refreshToken: 'def',
      expiresAt: 1000,
      refreshExpiresAt: 0,
    }

    bus.on('token:acquired', handler)
    bus.emit('token:acquired', payload)

    expect(handler).toHaveBeenCalledWith(payload)
  })

  it('should support multiple subscribers for same event', () => {
    const bus = createEventBus()
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    bus.on('token:expired', handler1)
    bus.on('token:expired', handler2)
    bus.emit('token:expired', {})

    expect(handler1).toHaveBeenCalledOnce()
    expect(handler2).toHaveBeenCalledOnce()
  })

  it('should not call subscriber for different event', () => {
    const bus = createEventBus()
    const handler = vi.fn()

    bus.on('token:expired', handler)
    bus.emit('token:acquired', {
      accessToken: 'a',
      refreshToken: 'b',
      expiresAt: 1,
      refreshExpiresAt: 0,
    })

    expect(handler).not.toHaveBeenCalled()
  })

  it('should unsubscribe when off is called', () => {
    const bus = createEventBus()
    const handler = vi.fn()

    bus.on('token:expired', handler)
    bus.off('token:expired', handler)
    bus.emit('token:expired', {})

    expect(handler).not.toHaveBeenCalled()
  })

  it('should unsubscribe via returned function', () => {
    const bus = createEventBus()
    const handler = vi.fn()

    const unsub = bus.on('token:expired', handler)
    unsub()
    bus.emit('token:expired', {})

    expect(handler).not.toHaveBeenCalled()
  })

  it('should support wildcard subscribers', () => {
    const bus = createEventBus()
    const handler = vi.fn()

    bus.on('api:*', handler)
    bus.emit('api:request', { url: '/test', method: 'GET' })
    bus.emit('api:response', { url: '/test', method: 'GET', status: 200, body: {} })

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('should not trigger wildcard for non-matching namespace', () => {
    const bus = createEventBus()
    const handler = vi.fn()

    bus.on('api:*', handler)
    bus.emit('token:expired', {})

    expect(handler).not.toHaveBeenCalled()
  })

  it('should handle emit with no subscribers gracefully', () => {
    const bus = createEventBus()
    expect(() => bus.emit('token:expired', {})).not.toThrow()
  })
})
