import type { StorageService } from './storage'

const CONSENT_KEY = 'consentAccepted'

/**
 * Check if the user has already accepted the consent dialog.
 */
export async function hasConsent(storage: StorageService): Promise<boolean> {
  const accepted = await storage.getForDomain<boolean>(CONSENT_KEY)
  return accepted === true
}

/**
 * Store consent acceptance.
 */
export async function storeConsent(storage: StorageService): Promise<void> {
  await storage.setForDomain(CONSENT_KEY, true)
}

/**
 * Reset consent (for settings "Reset Consent" button).
 */
export async function resetConsent(storage: StorageService): Promise<void> {
  await storage.setForDomain(CONSENT_KEY, false)
}

/**
 * Show the consent dialog overlay. Returns a promise that resolves
 * true if accepted, false if declined.
 */
export function showConsentDialog(version: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.id = 'npu-consent-overlay'
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    `

    const dialog = document.createElement('div')
    dialog.style.cssText = `
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 24px 28px;
      max-width: 440px;
      width: 90%;
      color: #e0e0e0;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    `

    // --- Title section ---
    const titleSection = document.createElement('div')
    titleSection.style.cssText = 'text-align: center; margin-bottom: 16px;'

    const titleSpan = document.createElement('span')
    titleSpan.style.cssText = 'font-size: 24px; font-weight: 700; color: #5c9eff;'
    titleSpan.textContent = 'Neptun PowerUp!'
    titleSection.appendChild(titleSpan)

    const versionDiv = document.createElement('div')
    versionDiv.style.cssText = 'font-size: 12px; color: #9e9e9e; margin-top: 4px;'
    versionDiv.textContent = `v${version}`
    titleSection.appendChild(versionDiv)

    dialog.appendChild(titleSection)

    // --- Acknowledgement paragraph ---
    const ackParagraph = document.createElement('div')
    ackParagraph.style.cssText = 'font-size: 13px; color: #bbb; margin-bottom: 14px;'
    ackParagraph.textContent = 'By using this tool, you acknowledge that it:'
    dialog.appendChild(ackParagraph)

    // --- Bullet points ---
    const bulletList = document.createElement('ul')
    bulletList.style.cssText = 'font-size: 12px; color: #ccc; line-height: 1.8; padding-left: 18px; margin: 0 0 16px 0;'

    const bullets: Array<{ bold: string; rest: string }> = [
      { bold: 'Maintains your session', rest: ' by refreshing the active Neptun session before it expires' },
      { bold: 'Automates course enrollment', rest: ' by clicking buttons and filling forms on your behalf' },
      { bold: 'Automates exam signup', rest: ' by enrolling for saved exam dates on your behalf' },
      { bold: 'May violate', rest: " your university's acceptable use policy" },
    ]

    for (const bullet of bullets) {
      const li = document.createElement('li')
      const strong = document.createElement('strong')
      strong.style.cssText = 'color: #ff9800;'
      strong.textContent = bullet.bold
      li.appendChild(strong)
      li.appendChild(document.createTextNode(bullet.rest))
      bulletList.appendChild(li)
    }

    dialog.appendChild(bulletList)

    // --- Liability notice ---
    const liabilityBox = document.createElement('div')
    liabilityBox.style.cssText = 'font-size: 11px; color: #9e9e9e; margin-bottom: 18px; padding: 8px 10px; background: #1a1a2e; border-radius: 6px; border-left: 3px solid #ff9800;'
    liabilityBox.textContent = "You are solely responsible for compliance with your university's policies. The authors accept no liability."
    dialog.appendChild(liabilityBox)

    // --- Buttons ---
    const btnContainer = document.createElement('div')
    btnContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center;'

    const acceptBtn = document.createElement('button')
    acceptBtn.style.cssText = 'padding: 8px 28px; background: #5c9eff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;'
    acceptBtn.textContent = 'I Accept'

    const declineBtn = document.createElement('button')
    declineBtn.style.cssText = 'padding: 8px 28px; background: transparent; color: #9e9e9e; border: 1px solid #2a2a4a; border-radius: 6px; cursor: pointer; font-size: 13px;'
    declineBtn.textContent = 'Decline'

    btnContainer.appendChild(acceptBtn)
    btnContainer.appendChild(declineBtn)
    dialog.appendChild(btnContainer)

    // --- Footer note ---
    const footerNote = document.createElement('div')
    footerNote.style.cssText = 'text-align: center; margin-top: 12px; font-size: 10px; color: #666;'
    footerNote.textContent = 'This prompt only appears once. You can reset it in Settings.'
    dialog.appendChild(footerNote)

    overlay.appendChild(dialog)

    function cleanup(accepted: boolean): void {
      overlay.remove()
      resolve(accepted)
    }

    try {
      document.body.appendChild(overlay)
    } catch {
      document.addEventListener('DOMContentLoaded', () => {
        if (!overlay.parentNode) document.body.appendChild(overlay)
      })
    }

    acceptBtn.addEventListener('click', () => cleanup(true))
    declineBtn.addEventListener('click', () => cleanup(false))
  })
}
