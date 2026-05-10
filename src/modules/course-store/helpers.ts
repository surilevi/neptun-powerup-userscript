import { WAIT_TIMEOUT_MS } from './state'

/**
 * Wait for an element matching `selector` to appear under `root`, using
 * MutationObserver with a timeout fallback.
 */
export function waitForElement(
  selector: string,
  root: Element | Document = document,
  timeoutMs: number = WAIT_TIMEOUT_MS,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = root.querySelector(selector)
    if (existing) {
      resolve(existing)
      return
    }

    let settled = false
    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector)
      if (el && !settled) {
        settled = true
        observer.disconnect()
        resolve(el)
      }
    })

    function settle(result: Element | null): void {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(result)
    }

    try {
      observer.observe(root instanceof Document ? root.body : root, {
        childList: true,
        subtree: true,
      })
    } catch {
      // If observe() throws (e.g. root is detached), settle immediately
      settle(null)
      return
    }

    setTimeout(() => settle(null), timeoutMs)
  })
}
