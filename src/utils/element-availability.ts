/**
 * Treat controls inside hidden, inert, or disabled containers as unavailable too.
 * Checking only the control's own computed style misses hidden tab/panel content.
 */
export function isElementAvailable(element: HTMLElement): boolean {
  if (!element.isConnected) return false

  if (element instanceof HTMLButtonElement && element.disabled) return false

  let current: HTMLElement | null = element
  while (current) {
    if (
      current.hidden ||
      current.hasAttribute('hidden') ||
      current.hasAttribute('inert') ||
      current.getAttribute('aria-hidden') === 'true' ||
      current.getAttribute('aria-disabled') === 'true'
    ) {
      return false
    }

    const style = window.getComputedStyle(current)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.pointerEvents === 'none'
    ) {
      return false
    }

    current = current.parentElement
  }

  return true
}
