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
    let observer: PerformanceObserver | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    function matches(entry: PerformanceEntry): boolean {
      if (!entry.name.includes(urlPattern)) return false
      return typeof entry.startTime !== 'number' || entry.startTime >= startedAfterMs
    }

    function findMatchingEntry(): PerformanceEntry | null {
      try {
        return performance.getEntriesByType('resource').find(matches) ?? null
      } catch {
        return null
      }
    }

    function settle(result: RequestCompletionResult): void {
      if (settled) return
      settled = true
      observer?.disconnect()
      if (pollTimer) clearInterval(pollTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      resolve(result)
    }

    function settleFromEntry(entry: PerformanceEntry): void {
      const resourceEntry = entry as PerformanceResourceTiming & { responseStatus?: number }
      const status =
        typeof resourceEntry.responseStatus === 'number' ? resourceEntry.responseStatus : null
      settle({
        completed: true,
        status,
      })
    }

    function checkExistingEntries(): void {
      const match = findMatchingEntry()
      if (match) settleFromEntry(match)
    }

    function startPollingFallback(): void {
      if (pollTimer) return
      pollTimer = setInterval(checkExistingEntries, 100)
    }

    const existingMatch = findMatchingEntry()
    if (existingMatch) {
      settleFromEntry(existingMatch)
      return
    }

    try {
      observer = new PerformanceObserver((list) => {
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
        try {
          observer.observe({ type: 'resource', buffered: false })
        } catch {
          observer.disconnect()
          observer = null
          startPollingFallback()
        }
      }
    } catch {
      startPollingFallback()
    }

    timeoutTimer = setTimeout(() => settle({ completed: false, status: null }), timeoutMs)
  })
}
