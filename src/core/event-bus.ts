import type { NpuEventMap, NpuEventName } from '../types/events'

type Handler<T> = (payload: T) => void
type WildcardHandler = (payload: unknown) => void

export interface EventBus {
  on<K extends NpuEventName>(event: K, handler: Handler<NpuEventMap[K]>): () => void
  on(event: `${string}:*`, handler: WildcardHandler): () => void
  off<K extends NpuEventName>(event: K, handler: Handler<NpuEventMap[K]>): void
  off(event: `${string}:*`, handler: WildcardHandler): void
  emit<K extends NpuEventName>(event: K, payload: NpuEventMap[K]): void
}

export function createEventBus(): EventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = new Map<string, Set<Handler<any>>>()
  const wildcards = new Map<string, Set<WildcardHandler>>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function on(event: string, handler: Handler<any>): () => void {
    if (event.endsWith(':*')) {
      const ns = event.slice(0, -2)
      if (!wildcards.has(ns)) wildcards.set(ns, new Set())
      wildcards.get(ns)!.add(handler)
      return () => wildcards.get(ns)?.delete(handler)
    }

    if (!handlers.has(event)) handlers.set(event, new Set())
    handlers.get(event)!.add(handler)
    return () => handlers.get(event)?.delete(handler)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function off(event: string, handler: Handler<any>): void {
    if (event.endsWith(':*')) {
      const ns = event.slice(0, -2)
      wildcards.get(ns)?.delete(handler)
    } else {
      handlers.get(event)?.delete(handler)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function emit(event: string, payload: any): void {
    handlers.get(event)?.forEach((h) => {
      try {
        h(payload)
      } catch (err) {
        console.error('[NPU:event-bus] handler error:', err)
      }
    })

    const ns = event.split(':')[0]
    wildcards.get(ns)?.forEach((h) => {
      try {
        h(payload)
      } catch (err) {
        console.error('[NPU:event-bus] wildcard handler error:', err)
      }
    })
  }

  return { on, off, emit } as EventBus
}
