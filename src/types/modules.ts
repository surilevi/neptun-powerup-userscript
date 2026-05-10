import type { EventBus } from '../core/event-bus'
import type { StorageService } from '../core/storage'
import type { Logger } from '../core/logger'
import type { StatusPanel } from '../core/status-panel'

export interface PageContext {
  url: string
  domain: string
  path: string
}

export interface ModuleApi {
  bus: EventBus
  storage: StorageService
  logger: Logger
  statusPanel: StatusPanel
}

export interface NpuModule {
  id: string
  name: string
  description: string
  shouldActivate(context: PageContext): boolean
  initialize(api: ModuleApi): void | Promise<void>
  dispose?(): void
}
