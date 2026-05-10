import { KNOWN_ENDPOINTS } from '../types/neptun-api'
import type { EventBus } from '../core/event-bus'

export function extractPath(url: string): string {
  const parsed = new URL(url)
  return parsed.pathname
}

const AUTH_PATTERNS = [
  KNOWN_ENDPOINTS.authenticate,
  KNOWN_ENDPOINTS.getNewTokens,
]

export function isAuthEndpoint(url: string): boolean {
  const path = extractPath(url).toLowerCase()
  return AUTH_PATTERNS.some((pattern) => path.toLowerCase().endsWith(pattern.toLowerCase()))
}

/**
 * Monitors SPA route changes and emits 'page:changed' events.
 * Angular uses pushState/replaceState for navigation, so we wrap both
 * and also listen for popstate (browser back/forward).
 *
 * Returns a cleanup function to remove listeners.
 */
export function observeRouteChanges(bus: EventBus): () => void {
  let lastPath = window.location.pathname

  function checkAndEmit(): void {
    const currentPath = window.location.pathname
    if (currentPath !== lastPath) {
      lastPath = currentPath
      bus.emit('page:changed', {
        url: window.location.href,
        path: currentPath,
      })
    }
  }

  // Wrap history.pushState and replaceState
  const originalPushState = history.pushState.bind(history)
  const originalReplaceState = history.replaceState.bind(history)

  history.pushState = function (...args) {
    originalPushState(...args)
    checkAndEmit()
  }

  history.replaceState = function (...args) {
    originalReplaceState(...args)
    checkAndEmit()
  }

  // Listen for popstate (back/forward navigation)
  window.addEventListener('popstate', checkAndEmit)

  return () => {
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
    window.removeEventListener('popstate', checkAndEmit)
  }
}
