import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createModuleRegistry } from '../../src/core/module-registry'
import { createEventBus } from '../../src/core/event-bus'
import type { NpuModule, PageContext, ModuleApi } from '../../src/types/modules'

function createMockModule(overrides: Partial<NpuModule> = {}): NpuModule {
  return {
    id: 'test-module',
    name: 'Test Module',
    description: 'A test module',
    shouldActivate: vi.fn(() => true),
    initialize: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  }
}

const defaultContext: PageContext = {
  url: 'https://example.hu/hallgato_ng/',
  domain: 'example.hu',
  path: '/hallgato_ng/',
}

describe('ModuleRegistry', () => {
  let bus: ReturnType<typeof createEventBus>

  beforeEach(() => {
    bus = createEventBus()
  })

  it('should register and activate a module', async () => {
    const mod = createMockModule()
    const registry = createModuleRegistry(bus)

    registry.register(mod)
    await registry.activateAll(defaultContext)

    expect(mod.shouldActivate).toHaveBeenCalledWith(defaultContext)
    expect(mod.initialize).toHaveBeenCalledOnce()
  })

  it('should pass ModuleApi to initialize', async () => {
    const mod = createMockModule()
    const registry = createModuleRegistry(bus)

    registry.register(mod)
    await registry.activateAll(defaultContext)

    const api = (mod.initialize as ReturnType<typeof vi.fn>).mock.calls[0][0] as ModuleApi
    expect(api.bus).toBeDefined()
    expect(api.storage).toBeDefined()
    expect(api.logger).toBeDefined()
    expect(api.statusPanel).toBeDefined()
  })

  it('should not activate module when shouldActivate returns false', async () => {
    const mod = createMockModule({ shouldActivate: vi.fn(() => false) })
    const registry = createModuleRegistry(bus)

    registry.register(mod)
    await registry.activateAll(defaultContext)

    expect(mod.initialize).not.toHaveBeenCalled()
  })

  it('should not activate an already-activated module twice', async () => {
    const mod = createMockModule()
    const registry = createModuleRegistry(bus)

    registry.register(mod)
    await registry.activateAll(defaultContext)
    await registry.activateAll(defaultContext)

    expect(mod.initialize).toHaveBeenCalledOnce()
  })

  it('should catch and emit error if module initialize throws', async () => {
    const errorHandler = vi.fn()
    bus.on('module:error', errorHandler)

    const mod = createMockModule({
      initialize: vi.fn(() => {
        throw new Error('module broke')
      }),
    })
    const registry = createModuleRegistry(bus)

    registry.register(mod)
    await registry.activateAll(defaultContext)

    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: 'test-module' }),
    )
  })

  it('should not block other modules when one throws', async () => {
    const errorHandler = vi.fn()
    bus.on('module:error', errorHandler)

    const badMod = createMockModule({
      id: 'bad-module',
      initialize: vi.fn(() => {
        throw new Error('broke')
      }),
    })
    const goodMod = createMockModule({ id: 'good-module' })
    const registry = createModuleRegistry(bus)

    registry.register(badMod)
    registry.register(goodMod)
    await registry.activateAll(defaultContext)

    expect(goodMod.initialize).toHaveBeenCalledOnce()
  })

  it('should call dispose on all activated modules', async () => {
    const mod = createMockModule()
    const registry = createModuleRegistry(bus)

    registry.register(mod)
    await registry.activateAll(defaultContext)
    registry.disposeAll()

    expect(mod.dispose).toHaveBeenCalledOnce()
  })
})
