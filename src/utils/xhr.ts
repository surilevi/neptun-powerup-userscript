export interface RequestCompletionResult {
  completed: boolean
  status: number | null
}

/**
 * Wait for a network request matching `urlPattern` to complete.
 *
 * Uses PerformanceObserver to detect when the browser finishes a request
 * whose URL contains the given pattern. This works reliably in Tampermonkey's
 * sandbox because PerformanceObserver is a browser-level API that tracks all
 * network requests regardless of JavaScript execution context.
 *
 * Resolves completion info for the first matching request, or a timeout result.
 */
export function waitForRequestComplete(
  urlPattern: string,
  timeoutMs: number,
  startedAfterMs: number = performance.now(),
): Promise<RequestCompletionResult> {
  return new Promise((resolve) => {
    let settled = false

    function matches(entry: PerformanceEntry): boolean {
      if (!entry.name.includes(urlPattern)) return false
      return typeof entry.startTime !== 'number' || entry.startTime >= startedAfterMs
    }

    function settle(result: RequestCompletionResult): void {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(result)
    }

    function settleFromEntry(entry: PerformanceEntry): void {
      const resourceEntry = entry as PerformanceResourceTiming & { responseStatus?: number }
      const status = typeof resourceEntry.responseStatus === 'number'
        ? resourceEntry.responseStatus
        : null
      settle({
        completed: true,
        status,
      })
    }

    const existingEntries = performance.getEntriesByType('resource')
    const existingMatch = existingEntries.find(matches)
    if (existingMatch) {
      settleFromEntry(existingMatch)
      return
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (matches(entry)) {
          settleFromEntry(entry)
          return
        }
      }
    })

    try {
      observer.observe({ type: 'resource', buffered: true })
    } catch {
      observer.observe({ type: 'resource', buffered: false })
    }

    setTimeout(() => settle({ completed: false, status: null }), timeoutMs)
  })
}
