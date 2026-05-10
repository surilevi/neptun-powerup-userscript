import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createLogger } from '../../src/core/logger'

describe('Logger', () => {
  let storage = new Map<string, string>()

  beforeEach(() => {
    storage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
        clear: () => {
          storage.clear()
        },
      },
    })
  })

  it('should prefix messages with [NPU:namespace]', () => {
    window.localStorage.setItem('npu_debug', 'true')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('test-module')

    logger.info('hello world')

    expect(spy).toHaveBeenCalledWith('[NPU:test-module]', 'hello world')
    spy.mockRestore()
  })

  it('should log warnings with prefix', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createLogger('test-module')

    logger.warn('something happened')

    expect(spy).toHaveBeenCalledWith('[NPU:test-module]', 'something happened')
    spy.mockRestore()
  })

  it('should log errors with prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createLogger('test-module')

    logger.error('bad thing', new Error('oops'))

    expect(spy).toHaveBeenCalledWith('[NPU:test-module]', 'bad thing', new Error('oops'))
    spy.mockRestore()
  })

  it('should pass multiple arguments through', () => {
    window.localStorage.setItem('npu_debug', 'true')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('core')

    logger.info('value:', 42, { key: 'val' })

    expect(spy).toHaveBeenCalledWith('[NPU:core]', 'value:', 42, { key: 'val' })
    spy.mockRestore()
  })

  it('should keep info logs quiet by default', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('core')

    logger.info('value:', 42)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
