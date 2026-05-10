import { isDebugEnabled, isDebugMessage } from '../utils/debug'

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function createLogger(namespace: string): Logger {
  const prefix = `[NPU:${namespace}]`

  return {
    info: (...args: unknown[]) => {
      if (!isDebugEnabled()) return
      console.log(prefix, ...args)
    },
    warn: (...args: unknown[]) => {
      if (!isDebugEnabled() && isDebugMessage(args)) return
      console.warn(prefix, ...args)
    },
    error: (...args: unknown[]) => console.error(prefix, ...args),
  }
}
