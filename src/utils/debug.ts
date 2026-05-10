const DEBUG_STORAGE_KEY = 'npu_debug'

const DEBUG_MESSAGE_TAGS = [
  '[dom-debug]',
  '[session-debug]',
  '[enroll-debug]',
  '[exam-enroll-debug]',
  '[exam-dom-debug]',
  '[interceptor-debug]',
]

export function isDebugEnabled(): boolean {
  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function isDebugMessage(args: unknown[]): boolean {
  for (const arg of args) {
    if (typeof arg !== 'string') continue
    if (DEBUG_MESSAGE_TAGS.some((tag) => arg.includes(tag))) {
      return true
    }
  }

  return false
}
