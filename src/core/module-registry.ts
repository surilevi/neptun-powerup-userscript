import type { EventBus } from './event-bus'
import type { StatusPanel } from './status-panel'
import type { NpuModule, PageContext, ModuleApi } from '../types/modules'
import { createStorageService, type GmStorage } from './storage'
import { createLogger } from './logger'

export interface ModuleRegistry {
  register(module: NpuModule): void
  activateAll(context: PageContext): Promise<void>
  disposeAll(): void
}

export function createModuleRegistry(
  bus: EventBus,
  gmStorage?: GmStorage,
  statusPanel?: StatusPanel,
): ModuleRegistry {
  const modules: NpuModule[] = []
  const activated = new Set<string>()
  let isActivating = false

  // Provide a no-op status panel fallback so modules always have a valid reference
  const panel: StatusPanel = statusPanel ?? {
    setSessionStatus: () => {},
    addMessage: () => {},
    setVersionWarning: () => {},
    setModuleContent: () => {},
    setModuleContentElement: () => {},
    expand: () => {},
    collapse: () => {},
    toggle: () => {},
    isExpanded: () => false,
    getCourseRushMode: () => false,
    setCourseRushMode: () => Promise.resolve(),
    getExamRushMode: () => false,
    setExamRushMode: () => Promise.resolve(),
    getThemeSettings: () => ({ enabled: false, color: 'pink' }),
    setThemeSettings: () => {},
    onThemeSettingsChange: () => () => {},
    dispose: () => {},
  }

  function register(module: NpuModule): void {
    modules.push(module)
  }

  async function activateAll(context: PageContext): Promise<void> {
    if (isActivating) return
    isActivating = true
    try {
      for (const mod of modules) {
        if (activated.has(mod.id)) continue

        if (!mod.shouldActivate(context)) continue

        const logger = createLogger(mod.id)
        const storage = createStorageService(
          gmStorage ?? { getValue: async () => undefined, setValue: async () => {} },
          context.domain,
        )
        const api: ModuleApi = { bus, storage, logger, statusPanel: panel }

        try {
          await mod.initialize(api)
          activated.add(mod.id)
          logger.info('activated')
        } catch (error) {
          bus.emit('module:error', { moduleId: mod.id, error })
          logger.error('failed to activate:', error)
        }
      }
    } finally {
      isActivating = false
    }
  }

  function disposeAll(): void {
    for (const mod of modules) {
      if (!activated.has(mod.id)) continue
      // Remove from activated BEFORE calling dispose, so even if dispose throws,
      // the module can be re-activated on the next activateAll() call.
      activated.delete(mod.id)
      try {
        mod.dispose?.()
      } catch (error) {
        const logger = createLogger(mod.id)
        logger.error('failed to dispose:', error)
      }
    }
  }

  return { register, activateAll, disposeAll }
}
