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
 * Reset consent from the settings panel.
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

    const ackParagraph = document.createElement('div')
    ackParagraph.style.cssText = 'font-size: 13px; color: #bbb; margin-bottom: 14px;'
    ackParagraph.textContent = 'Before using NPU, please confirm that you understand what it does:'
    dialog.appendChild(ackParagraph)

    const bulletList = document.createElement('ul')
    bulletList.style.cssText =
      'font-size: 12px; color: #ccc; line-height: 1.8; padding-left: 18px; margin: 0 0 16px 0;'

    const bullets: Array<{ bold: string; rest: string }> = [
      {
        bold: 'Session keep-alive is best-effort',
        rest: '; Neptun may still force logout during course or exam rushes',
      },
      { bold: 'Clicks course controls', rest: ' when you ask it to enroll saved selections' },
      { bold: 'Clicks exam controls', rest: ' when you ask it to enroll saved exam dates' },
      { bold: 'May conflict with rules', rest: ' at your university or faculty' },
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

    const liabilityBox = document.createElement('div')
    liabilityBox.style.cssText =
      'font-size: 11px; color: #9e9e9e; margin-bottom: 18px; padding: 8px 10px; background: #1a1a2e; border-radius: 6px; border-left: 3px solid #ff9800;'
    liabilityBox.textContent =
      'Use it only if it is allowed for your account. You are responsible for the result.'
    dialog.appendChild(liabilityBox)

    const btnContainer = document.createElement('div')
    btnContainer.style.cssText = 'display: flex; gap: 10px; justify-content: center;'

    const acceptBtn = document.createElement('button')
    acceptBtn.style.cssText =
      'padding: 8px 28px; background: #5c9eff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;'
    acceptBtn.textContent = 'Accept'

    const declineBtn = document.createElement('button')
    declineBtn.style.cssText =
      'padding: 8px 28px; background: transparent; color: #9e9e9e; border: 1px solid #2a2a4a; border-radius: 6px; cursor: pointer; font-size: 13px;'
    declineBtn.textContent = 'Decline'

    btnContainer.appendChild(acceptBtn)
    btnContainer.appendChild(declineBtn)
    dialog.appendChild(btnContainer)

    const footerNote = document.createElement('div')
    footerNote.style.cssText = 'text-align: center; margin-top: 12px; font-size: 10px; color: #666;'
    footerNote.textContent = 'You can show this prompt again from Settings.'
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
