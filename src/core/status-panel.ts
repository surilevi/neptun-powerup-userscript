import type { EventBus } from './event-bus'
import type { ThemeSettings } from '../modules/pink-mode'
import { DEFAULT_THEME, THEME_PRESETS } from '../modules/pink-mode'
import { getScriptVersion } from '../utils/script-version'

// ---------------------------------------------------------------------------
// Rush mode callback types
// ---------------------------------------------------------------------------

export interface RushModeCallbacks {
  /** Returns once the new value is durably persisted, so a rush can disarm before it acts. */
  onCourseRushChange: (on: boolean) => void | Promise<void>
  onExamRushChange: (on: boolean) => void | Promise<void>
  onConsentReset?: () => void
  onThemeChange?: (settings: ThemeSettings) => void
  onExportSavedChoices?: () => string | null | Promise<string | null>
  onImportSavedChoices?: () => string | null | Promise<string | null>
}

export interface RushModeInitialState {
  courseRush: boolean
  examRush: boolean
}

export interface VersionWarning {
  title: string
  detail: string
  current: string
  previous?: string
  actionLabel: string
  onAction: () => void | Promise<void>
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StatusPanel {
  setSessionStatus(
    state: 'active' | 'expiring' | 'expired' | 'refreshing',
    remainingMs?: number,
  ): void
  addMessage(level: 'info' | 'warn' | 'error', text: string): void
  setVersionWarning(warning: VersionWarning | null): void
  setModuleContent(text: string): void
  setModuleContentElement(element: HTMLElement): void
  expand(): void
  collapse(): void
  toggle(): void
  isExpanded(): boolean
  getCourseRushMode(): boolean
  /** Resolves once the change is persisted; await it before starting a rush run. */
  setCourseRushMode(on: boolean): Promise<void>
  getExamRushMode(): boolean
  setExamRushMode(on: boolean): Promise<void>
  getThemeSettings(): ThemeSettings
  setThemeSettings(settings: ThemeSettings): void
  onThemeSettingsChange(callback: (settings: ThemeSettings) => void): () => void
  dispose(): void
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LogEntry {
  level: 'info' | 'warn' | 'error'
  text: string
  time: string
}

const MAX_MESSAGES = 5

const COLORS = {
  bg: '#16213e',
  bgDark: '#1a1a2e',
  text: '#e0e0e0',
  textMuted: '#9e9e9e',
  accent: '#5c9eff',
  border: '#2a2a4a',
  green: '#4caf50',
  yellow: '#ff9800',
  red: '#f44336',
} as const

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.ceil(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `${min}m ${pad2(sec)}s` : `${sec}s`
}

function levelIcon(level: 'info' | 'warn' | 'error'): string {
  switch (level) {
    case 'info':
      return '\u2713' // checkmark
    case 'warn':
      return '\u26A0' // warning sign
    case 'error':
      return '\u2715' // X mark
  }
}

function levelColor(level: 'info' | 'warn' | 'error'): string {
  switch (level) {
    case 'info':
      return COLORS.green
    case 'warn':
      return COLORS.yellow
    case 'error':
      return COLORS.red
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createStatusPanel(
  bus: EventBus,
  rushCallbacks?: RushModeCallbacks,
  rushInitial?: RushModeInitialState,
  themeInitial?: ThemeSettings,
): StatusPanel {
  // --- State ---
  let expanded = false
  let sessionState: 'active' | 'expiring' | 'expired' | 'refreshing' = 'active'
  let sessionRemainingMs = 0
  let countdownTimer: ReturnType<typeof setInterval> | null = null
  let flashTimer: ReturnType<typeof setTimeout> | null = null
  let isFlashing = false
  const messages: LogEntry[] = []
  const unsubs: (() => void)[] = []

  // --- Rush mode state ---
  let courseRushOn = rushInitial?.courseRush ?? false
  let examRushOn = rushInitial?.examRush ?? false

  // --- Settings state ---
  let settingsVisible = false
  let settingsContainer: HTMLElement | null = null
  let normalContent: HTMLElement | null = null
  let gearBtn: HTMLElement | null = null
  let titleSpanRef: HTMLElement | null = null // promoted from local in build() so toggleSettings() can access it

  // --- Theme state ---
  let themeSettings: ThemeSettings = themeInitial ? { ...themeInitial } : { ...DEFAULT_THEME }
  const themeChangeCallbacks: Array<(settings: ThemeSettings) => void> = []

  // --- DOM refs ---
  let root: HTMLElement | null = null
  let badge: HTMLElement | null = null
  let badgeDot: HTMLElement | null = null
  let panel: HTMLElement | null = null
  let headerDot: HTMLElement | null = null
  let sessionLine: HTMLElement | null = null
  let messageList: HTMLElement | null = null
  let versionWarningSection: HTMLElement | null = null
  let moduleSection: HTMLElement | null = null
  let minimizeBtn: HTMLElement | null = null
  let courseRushToggle: HTMLInputElement | null = null
  let examRushToggle: HTMLInputElement | null = null

  // --- Build DOM ---
  function build(): void {
    // Root container (fixed, bottom-right)
    root = document.createElement('div')
    root.id = 'npu-status-root'
    root.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 99999;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: ${COLORS.text};
      line-height: 1.4;
    `

    // ---------- Badge (collapsed) ----------
    badge = document.createElement('div')
    badge.id = 'npu-badge'
    badge.style.cssText = `
      width: 40px;
      height: 40px;
      border-radius: 20px;
      background: ${COLORS.bgDark};
      border: 1px solid ${COLORS.border};
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0.85;
      transition: opacity 0.2s;
      position: relative;
      user-select: none;
    `
    badge.addEventListener('mouseenter', () => {
      if (badge) badge.style.opacity = '1'
    })
    badge.addEventListener('mouseleave', () => {
      if (badge) badge.style.opacity = '0.85'
    })

    const badgeLabel = document.createElement('span')
    badgeLabel.style.cssText = `
      font-size: 11px;
      font-weight: 700;
      color: ${COLORS.accent};
      letter-spacing: 0.5px;
    `
    badgeLabel.textContent = 'NPU'
    badge.appendChild(badgeLabel)

    badgeDot = document.createElement('span')
    badgeDot.style.cssText = `
      position: absolute;
      top: 4px;
      right: 4px;
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: ${COLORS.green};
    `
    badge.appendChild(badgeDot)

    badge.addEventListener('click', () => toggle())
    root.appendChild(badge)

    // ---------- Panel (expanded) ----------
    panel = document.createElement('div')
    panel.id = 'npu-panel'
    panel.style.cssText = `
      width: 320px;
      max-height: 400px;
      overflow-y: auto;
      background: ${COLORS.bg};
      border: 1px solid ${COLORS.border};
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: none;
      flex-direction: column;
    `

    // Header
    const header = document.createElement('div')
    header.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
    `

    titleSpanRef = document.createElement('span')
    titleSpanRef.style.cssText = `
      font-weight: 700;
      font-size: 14px;
      color: ${COLORS.accent};
      flex: 1;
    `
    titleSpanRef.textContent = 'Neptun PowerUp!'
    header.appendChild(titleSpanRef)

    // Always visible: several builds of this script exist side by side, and the
    // version is the only reliable way to tell which one is actually running.
    const versionSpan = document.createElement('span')
    versionSpan.style.cssText = `
      font-size: 10px;
      font-weight: 600;
      color: ${COLORS.textMuted};
      margin-right: 8px;
      flex-shrink: 0;
    `
    versionSpan.textContent = `v${getScriptVersion()}`
    versionSpan.title = 'Installed Neptun PowerUp! userscript version'
    header.appendChild(versionSpan)

    headerDot = document.createElement('span')
    headerDot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 4px;
      background: ${COLORS.green};
      margin-right: 10px;
    `
    header.appendChild(headerDot)

    gearBtn = document.createElement('button')
    gearBtn.style.cssText = `
      background: none;
      border: none;
      color: ${COLORS.textMuted};
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
      line-height: 1;
      margin-right: 6px;
    `
    gearBtn.textContent = '\u2699' // gear icon
    gearBtn.title = 'Settings'
    gearBtn.addEventListener('click', () => toggleSettings())
    header.appendChild(gearBtn)

    minimizeBtn = document.createElement('button')
    minimizeBtn.style.cssText = `
      background: none;
      border: none;
      color: ${COLORS.textMuted};
      cursor: pointer;
      font-size: 16px;
      padding: 0 2px;
      line-height: 1;
    `
    minimizeBtn.textContent = '\u2715' // X
    minimizeBtn.addEventListener('click', () => collapse())
    header.appendChild(minimizeBtn)

    panel.appendChild(header)

    // Session section
    const sessionSection = document.createElement('div')
    sessionSection.style.cssText = `
      padding: 8px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
    `

    sessionLine = document.createElement('div')
    sessionLine.style.cssText = `
      font-size: 12px;
      color: ${COLORS.textMuted};
    `
    sessionLine.textContent = 'Session: waiting for token...'
    sessionLine.title =
      'Session keep-alive is best-effort. Neptun may still force logout during course or exam registration rushes.'
    sessionSection.appendChild(sessionLine)

    // Rush mode toggles section
    const rushSection = document.createElement('div')
    rushSection.style.cssText = `
      padding: 8px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
      display: flex;
      gap: 14px;
      align-items: center;
    `

    // Inject toggle switch CSS and pulse animation (scoped via id)
    const styleEl = document.createElement('style')
    styleEl.textContent = `
      @keyframes npu-pulse {
        0%, 100% { box-shadow: 0 0 4px rgba(92, 158, 255, 0.3); }
        50% { box-shadow: 0 0 12px rgba(92, 158, 255, 0.8); }
      }
      .npu-rush-toggle {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 11px;
        color: ${COLORS.textMuted};
        user-select: none;
      }
      .npu-rush-toggle input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
      }
      .npu-rush-track {
        position: relative;
        width: 30px;
        height: 16px;
        background: #555;
        border-radius: 8px;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .npu-rush-track::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 12px;
        height: 12px;
        background: white;
        border-radius: 50%;
        transition: transform 0.2s;
      }
      .npu-rush-toggle input:checked + .npu-rush-track {
        background: ${COLORS.green};
      }
      .npu-rush-toggle input:checked + .npu-rush-track::after {
        transform: translateX(14px);
      }
    `
    rushSection.appendChild(styleEl)

    // Course Rush toggle
    const courseLabel = document.createElement('label')
    courseLabel.className = 'npu-rush-toggle'
    courseLabel.title =
      'After login, enroll exact courses already added to Neptun timetable planner. Locally saved courses are the fallback when the planner is empty. Disable Neptun’s registration confirmation popup first.'
    courseRushToggle = document.createElement('input')
    courseRushToggle.type = 'checkbox'
    courseRushToggle.checked = courseRushOn
    courseRushToggle.addEventListener('change', () => {
      courseRushOn = courseRushToggle!.checked
      updateDots()
      rushCallbacks?.onCourseRushChange(courseRushOn)
    })
    const courseTrack = document.createElement('span')
    courseTrack.className = 'npu-rush-track'
    const courseLabelText = document.createElement('span')
    courseLabelText.textContent = 'Course Rush'
    courseLabel.appendChild(courseRushToggle)
    courseLabel.appendChild(courseTrack)
    courseLabel.appendChild(courseLabelText)
    rushSection.appendChild(courseLabel)

    // Exam Rush toggle
    const examLabel = document.createElement('label')
    examLabel.className = 'npu-rush-toggle'
    examLabel.title =
      'After login, open exams and enroll saved dates. Session keep-alive is not guaranteed during registration rushes.'
    examRushToggle = document.createElement('input')
    examRushToggle.type = 'checkbox'
    examRushToggle.checked = examRushOn
    examRushToggle.addEventListener('change', () => {
      examRushOn = examRushToggle!.checked
      updateDots()
      rushCallbacks?.onExamRushChange(examRushOn)
    })
    const examTrack = document.createElement('span')
    examTrack.className = 'npu-rush-track'
    const examLabelText = document.createElement('span')
    examLabelText.textContent = 'Exam Rush'
    examLabel.appendChild(examRushToggle)
    examLabel.appendChild(examTrack)
    examLabel.appendChild(examLabelText)
    rushSection.appendChild(examLabel)

    // Version change warning section
    versionWarningSection = document.createElement('div')
    versionWarningSection.id = 'npu-version-warning'
    versionWarningSection.style.cssText = `
      display: none;
      padding: 8px 14px;
      border-bottom: 1px solid ${COLORS.border};
      flex-shrink: 0;
    `

    // Message feed section
    const messageFeedSection = document.createElement('div')
    messageFeedSection.style.cssText = `
      padding: 6px 14px;
      max-height: 120px;
      overflow-y: auto;
      flex-shrink: 0;
    `

    messageList = document.createElement('div')
    messageList.id = 'npu-messages'
    messageFeedSection.appendChild(messageList)

    // Module section
    moduleSection = document.createElement('div')
    moduleSection.id = 'npu-module-section'
    moduleSection.style.cssText = `
      padding: 8px 14px;
      flex-shrink: 0;
    `

    // Wrap content sections so they can be toggled with settings view
    normalContent = document.createElement('div')
    normalContent.id = 'npu-normal-content'
    normalContent.appendChild(sessionSection)
    normalContent.appendChild(rushSection)
    normalContent.appendChild(versionWarningSection)
    normalContent.appendChild(messageFeedSection)
    normalContent.appendChild(moduleSection)
    panel.appendChild(normalContent)

    settingsContainer = document.createElement('div')
    settingsContainer.id = 'npu-settings'
    settingsContainer.style.cssText = `padding: 12px 14px; display: none;`
    buildSettingsContent(settingsContainer)
    panel.appendChild(settingsContainer)

    root.appendChild(panel)

    try {
      document.body.appendChild(root)
    } catch {
      // Body is not ready yet; attach the panel after DOMContentLoaded.
      document.addEventListener('DOMContentLoaded', () => {
        if (root && !root.parentNode) {
          document.body.appendChild(root)
        }
      })
    }
  }

  // --- Settings helpers ---

  function buildSettingsContent(container: HTMLElement): void {
    const appearanceHeader = document.createElement('div')
    appearanceHeader.style.cssText = `color: ${COLORS.accent}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;`
    appearanceHeader.textContent = 'Appearance'
    container.appendChild(appearanceHeader)

    const themeRow = document.createElement('div')
    themeRow.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 8px;'

    // Theme toggle
    const themeLabel = document.createElement('label')
    themeLabel.className = 'npu-rush-toggle'
    const themeCheckbox = document.createElement('input')
    themeCheckbox.type = 'checkbox'
    themeCheckbox.checked = themeSettings.enabled
    const themeTrack = document.createElement('span')
    themeTrack.className = 'npu-rush-track'
    const themeLabelText = document.createElement('span')
    themeLabelText.textContent = 'Theme'
    themeLabel.appendChild(themeCheckbox)
    themeLabel.appendChild(themeTrack)
    themeLabel.appendChild(themeLabelText)
    themeRow.appendChild(themeLabel)

    // Color circles
    const colorRow = document.createElement('div')
    colorRow.style.cssText = 'display: flex; gap: 6px; margin-left: auto;'

    function updateColorCircles(): void {
      colorRow.querySelectorAll('.npu-color-circle').forEach((el) => {
        const circle = el as HTMLElement
        const isActive = circle.dataset.color === themeSettings.color
        circle.style.border = isActive ? '2px solid white' : '2px solid transparent'
        circle.style.transform = isActive ? 'scale(1.15)' : 'scale(1)'
      })
    }

    for (const preset of THEME_PRESETS) {
      const circle = document.createElement('div')
      circle.className = 'npu-color-circle'
      circle.dataset.color = preset.key
      circle.title = preset.name
      circle.style.cssText = `
        width: 18px; height: 18px; border-radius: 50%;
        background: ${preset.primary}; cursor: pointer;
        transition: transform 0.15s, border 0.15s;
        border: 2px solid ${themeSettings.color === preset.key ? 'white' : 'transparent'};
        transform: ${themeSettings.color === preset.key ? 'scale(1.15)' : 'scale(1)'};
      `
      circle.addEventListener('click', () => {
        themeSettings.color = preset.key
        if (!themeSettings.enabled) {
          themeSettings.enabled = true
          themeCheckbox.checked = true
        }
        updateColorCircles()
        notifyThemeChange()
      })
      colorRow.appendChild(circle)
    }

    themeCheckbox.addEventListener('change', () => {
      themeSettings.enabled = themeCheckbox.checked
      notifyThemeChange()
    })

    themeRow.appendChild(colorRow)
    container.appendChild(themeRow)

    if (rushCallbacks?.onExportSavedChoices || rushCallbacks?.onImportSavedChoices) {
      const dataHeader = document.createElement('div')
      dataHeader.style.cssText = `color: ${COLORS.accent}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 16px; margin-bottom: 8px; padding-top: 12px; border-top: 1px solid ${COLORS.border};`
      dataHeader.textContent = 'Saved choices'
      container.appendChild(dataHeader)

      const dataNote = document.createElement('div')
      dataNote.style.cssText = `font-size: 10px; color: ${COLORS.textMuted}; margin-bottom: 8px;`
      dataNote.textContent =
        'Back up or replace the saved course and exam choices for this Neptun domain.'
      container.appendChild(dataNote)

      const dataActions = document.createElement('div')
      dataActions.style.cssText = 'display: flex; gap: 6px;'
      container.appendChild(dataActions)

      const dataStatus = document.createElement('div')
      dataStatus.id = 'npu-saved-choices-status'
      dataStatus.setAttribute('aria-live', 'polite')
      dataStatus.style.cssText = `font-size: 10px; color: ${COLORS.textMuted}; margin-top: 6px; min-height: 14px;`
      container.appendChild(dataStatus)

      async function runDataAction(
        button: HTMLButtonElement,
        pendingLabel: string,
        action: () => string | null | Promise<string | null>,
      ): Promise<void> {
        const originalLabel = button.textContent ?? ''
        const actionButtons = Array.from(dataActions.querySelectorAll('button'))
        for (const actionButton of actionButtons) {
          actionButton.disabled = true
          actionButton.style.opacity = '0.7'
        }
        button.textContent = pendingLabel
        dataStatus.textContent = ''

        try {
          const message = await action()
          if (message) {
            dataStatus.style.color = COLORS.green
            dataStatus.textContent = message
          }
        } catch (err) {
          dataStatus.style.color = COLORS.red
          dataStatus.textContent = err instanceof Error ? err.message : String(err)
        } finally {
          for (const actionButton of actionButtons) {
            actionButton.disabled = false
            actionButton.style.opacity = '1'
          }
          button.textContent = originalLabel
        }
      }

      const dataButtonStyle = `flex: 1; padding: 5px 8px; background: transparent; color: ${COLORS.text}; border: 1px solid ${COLORS.border}; border-radius: 4px; cursor: pointer; font-size: 11px;`

      if (rushCallbacks.onExportSavedChoices) {
        const exportBtn = document.createElement('button')
        exportBtn.id = 'npu-export-saved-choices'
        exportBtn.type = 'button'
        exportBtn.style.cssText = dataButtonStyle
        exportBtn.textContent = 'Export JSON'
        exportBtn.addEventListener('click', () => {
          runDataAction(exportBtn, 'Exporting...', rushCallbacks.onExportSavedChoices!).catch(
            () => undefined,
          )
        })
        dataActions.appendChild(exportBtn)
      }

      if (rushCallbacks.onImportSavedChoices) {
        const importBtn = document.createElement('button')
        importBtn.id = 'npu-import-saved-choices'
        importBtn.type = 'button'
        importBtn.style.cssText = dataButtonStyle
        importBtn.textContent = 'Import JSON'
        importBtn.addEventListener('click', () => {
          runDataAction(importBtn, 'Importing...', rushCallbacks.onImportSavedChoices!).catch(
            () => undefined,
          )
        })
        dataActions.appendChild(importBtn)
      }
    }

    // Legal section
    const legalHeader = document.createElement('div')
    legalHeader.style.cssText = `color: ${COLORS.accent}; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 16px; margin-bottom: 10px; padding-top: 12px; border-top: 1px solid ${COLORS.border};`
    legalHeader.textContent = 'Consent'
    container.appendChild(legalHeader)

    const resetBtn = document.createElement('button')
    resetBtn.style.cssText = `padding: 5px 12px; background: transparent; color: ${COLORS.red}; border: 1px solid ${COLORS.red}; border-radius: 4px; cursor: pointer; font-size: 11px;`
    resetBtn.textContent = 'Show Consent Again'
    resetBtn.addEventListener('click', async () => {
      rushCallbacks?.onConsentReset?.()
      resetBtn.textContent = 'Consent will show again'
      resetBtn.style.color = COLORS.green
      resetBtn.style.borderColor = COLORS.green
      setTimeout(() => {
        resetBtn.textContent = 'Show Consent Again'
        resetBtn.style.color = COLORS.red
        resetBtn.style.borderColor = COLORS.red
      }, 2000)
    })
    container.appendChild(resetBtn)

    const resetNote = document.createElement('div')
    resetNote.style.cssText = `font-size: 10px; color: #666; margin-top: 4px;`
    resetNote.textContent = 'The consent prompt appears on the next page load'
    container.appendChild(resetNote)
  }

  function notifyThemeChange(): void {
    const copy = { ...themeSettings }
    for (const cb of themeChangeCallbacks) cb(copy)
    rushCallbacks?.onThemeChange?.(copy)
  }

  function toggleSettings(): void {
    settingsVisible = !settingsVisible
    if (normalContent) normalContent.style.display = settingsVisible ? 'none' : 'block'
    if (settingsContainer) settingsContainer.style.display = settingsVisible ? 'block' : 'none'
    if (titleSpanRef)
      titleSpanRef.textContent = settingsVisible ? '\u2699 Settings' : 'Neptun PowerUp!'
  }

  // --- Render helpers ---

  function dotColor(): string {
    if (isFlashing) return COLORS.red
    switch (sessionState) {
      case 'active':
        return COLORS.green
      case 'expiring':
        return COLORS.yellow
      case 'expired':
        return COLORS.red
      case 'refreshing':
        return COLORS.yellow
    }
  }

  function updateDots(): void {
    const color = dotColor()
    if (badgeDot) badgeDot.style.background = color
    if (headerDot) headerDot.style.background = color
    if (badge) {
      if (courseRushOn || examRushOn) {
        badge.style.animation = 'npu-pulse 2s ease-in-out infinite'
      } else {
        badge.style.animation = ''
      }
    }
  }

  function renderSessionLine(): void {
    if (!sessionLine) return

    switch (sessionState) {
      case 'active':
        sessionLine.textContent =
          sessionRemainingMs > 0
            ? `Session: ${formatCountdown(sessionRemainingMs)}`
            : 'Session: active'
        sessionLine.style.color = COLORS.text
        break
      case 'expiring':
        sessionLine.textContent = `Session: ${formatCountdown(sessionRemainingMs)} (expiring)`
        sessionLine.style.color = COLORS.yellow
        break
      case 'expired':
        sessionLine.textContent = 'Session expired'
        sessionLine.style.color = COLORS.red
        break
      case 'refreshing':
        sessionLine.textContent = 'Session: refreshing...'
        sessionLine.style.color = COLORS.yellow
        break
    }
  }

  function renderMessages(): void {
    if (!messageList) return
    // Clear children
    while (messageList.firstChild) messageList.removeChild(messageList.firstChild)

    if (messages.length === 0) return

    for (const entry of messages) {
      const row = document.createElement('div')
      row.style.cssText = `
        font-size: 11px;
        padding: 2px 0;
        display: flex;
        gap: 6px;
        align-items: baseline;
      `

      const icon = document.createElement('span')
      icon.textContent = levelIcon(entry.level)
      icon.style.color = levelColor(entry.level)
      icon.style.flexShrink = '0'
      row.appendChild(icon)

      const text = document.createElement('span')
      text.style.cssText = `flex: 1; word-break: break-word;`
      text.textContent = entry.text
      row.appendChild(text)

      const time = document.createElement('span')
      time.style.cssText = `
        color: ${COLORS.textMuted};
        font-size: 10px;
        flex-shrink: 0;
      `
      time.textContent = entry.time
      row.appendChild(time)

      messageList.appendChild(row)
    }
  }

  function setVersionWarning(warning: VersionWarning | null): void {
    if (!versionWarningSection) return

    while (versionWarningSection.firstChild) {
      versionWarningSection.removeChild(versionWarningSection.firstChild)
    }

    if (!warning) {
      versionWarningSection.style.display = 'none'
      return
    }

    versionWarningSection.style.display = 'block'

    const title = document.createElement('div')
    title.style.cssText = `font-size: 12px; font-weight: 700; color: ${COLORS.yellow}; margin-bottom: 4px;`
    title.textContent = warning.title
    versionWarningSection.appendChild(title)

    const detail = document.createElement('div')
    detail.style.cssText = `font-size: 11px; color: ${COLORS.text}; margin-bottom: 6px;`
    detail.textContent = warning.detail
    versionWarningSection.appendChild(detail)

    const versions = document.createElement('div')
    versions.style.cssText = `font-size: 10px; color: ${COLORS.textMuted}; line-height: 1.4; margin-bottom: 8px; word-break: break-word;`
    versions.textContent = warning.previous
      ? `Previous: ${warning.previous} | Current: ${warning.current}`
      : `Current: ${warning.current}`
    versionWarningSection.appendChild(versions)

    const action = document.createElement('button')
    action.type = 'button'
    action.style.cssText = `padding: 5px 10px; background: ${COLORS.yellow}; color: #1a1a2e; border: 0; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;`
    action.textContent = warning.actionLabel
    action.addEventListener('click', async () => {
      action.setAttribute('disabled', 'true')
      action.style.opacity = '0.7'
      await warning.onAction()
    })
    versionWarningSection.appendChild(action)
  }

  // --- Countdown ticker ---

  function startCountdown(): void {
    stopCountdown()
    countdownTimer = setInterval(() => {
      if (sessionState === 'active' || sessionState === 'expiring') {
        sessionRemainingMs = Math.max(0, sessionRemainingMs - 1000)
        if (sessionRemainingMs <= 60000 && sessionState === 'active') {
          // Less than 1 minute left on refresh token — warn user
          sessionState = 'expiring'
          updateDots()
        }
        if (sessionRemainingMs <= 0) {
          // Refresh token expired — session is truly dead, need to re-login
          sessionState = 'expired'
          updateDots()
        }
        renderSessionLine()
      }
    }, 1000)
  }

  function stopCountdown(): void {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  // --- Flash badge red on error/warning ---

  function flashBadge(): void {
    if (isFlashing) return
    isFlashing = true
    updateDots()

    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      isFlashing = false
      updateDots()
      flashTimer = null
    }, 3000)
  }

  // --- Public methods ---

  function setSessionStatus(
    state: 'active' | 'expiring' | 'expired' | 'refreshing',
    remainingMs?: number,
  ): void {
    sessionState = state
    if (remainingMs !== undefined) {
      sessionRemainingMs = remainingMs
    }
    updateDots()
    renderSessionLine()
    if ((state === 'active' || state === 'expiring') && sessionRemainingMs > 0) {
      startCountdown()
    }
  }

  function addMessage(level: 'info' | 'warn' | 'error', text: string): void {
    const entry: LogEntry = {
      level,
      text,
      time: formatTime(new Date()),
    }
    // newest on top
    messages.unshift(entry)
    if (messages.length > MAX_MESSAGES) messages.pop()

    renderMessages()

    if (level === 'error' || level === 'warn') {
      flashBadge()
    }
  }

  function setModuleContent(text: string): void {
    if (!moduleSection) return
    // For XSS safety, set text content (no HTML parsing)
    moduleSection.textContent = text
  }

  function setModuleContentElement(element: HTMLElement): void {
    if (!moduleSection) return
    // Auto-close settings if a module pushes content (e.g., retry status)
    // so time-sensitive information is immediately visible
    if (settingsVisible) {
      settingsVisible = false
      if (normalContent) normalContent.style.display = 'block'
      if (settingsContainer) settingsContainer.style.display = 'none'
      if (titleSpanRef) titleSpanRef.textContent = 'Neptun PowerUp!'
    }
    while (moduleSection.firstChild) moduleSection.removeChild(moduleSection.firstChild)
    moduleSection.appendChild(element)
  }

  function expand(): void {
    if (expanded) return
    expanded = true
    if (badge) badge.style.display = 'none'
    if (panel) panel.style.display = 'flex'
  }

  function collapse(): void {
    if (!expanded) return
    expanded = false
    // Reset settings view so re-expand shows normal content
    if (settingsVisible) {
      settingsVisible = false
      if (normalContent) normalContent.style.display = 'block'
      if (settingsContainer) settingsContainer.style.display = 'none'
      if (titleSpanRef) titleSpanRef.textContent = 'Neptun PowerUp!'
    }
    if (badge) badge.style.display = 'flex'
    if (panel) panel.style.display = 'none'
  }

  function toggle(): void {
    if (expanded) collapse()
    else expand()
  }

  function isExpandedFn(): boolean {
    return expanded
  }

  // --- Rush mode accessors ---

  function getCourseRushMode(): boolean {
    return courseRushOn
  }

  /**
   * Programmatic rush-mode changes must persist exactly like a user toggle.
   * Assigning `checked` does not fire a `change` event, so the persistence
   * callback has to be invoked here. Without it a rush that "turns itself off"
   * stays armed in storage and re-runs on every later page load.
   */
  async function setCourseRushModeValue(on: boolean): Promise<void> {
    if (courseRushOn === on) return
    courseRushOn = on
    if (courseRushToggle) courseRushToggle.checked = on
    updateDots()
    await rushCallbacks?.onCourseRushChange(on)
  }

  function getExamRushMode(): boolean {
    return examRushOn
  }

  async function setExamRushModeValue(on: boolean): Promise<void> {
    if (examRushOn === on) return
    examRushOn = on
    if (examRushToggle) examRushToggle.checked = on
    updateDots()
    await rushCallbacks?.onExamRushChange(on)
  }

  function dispose(): void {
    stopCountdown()
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = null
    }
    for (const unsub of unsubs) unsub()
    unsubs.length = 0
    themeChangeCallbacks.length = 0
    root?.remove()
    root = null
    badge = null
    badgeDot = null
    panel = null
    headerDot = null
    sessionLine = null
    messageList = null
    versionWarningSection = null
    moduleSection = null
    minimizeBtn = null
    courseRushToggle = null
    examRushToggle = null
    gearBtn = null
    settingsContainer = null
    normalContent = null
    titleSpanRef = null
  }

  // --- Event bus subscriptions ---

  function subscribe(): void {
    unsubs.push(
      bus.on('token:acquired', (payload) => {
        // Use refresh token expiry (30 min rolling) for the session countdown,
        // not the access token (5 min). The access token refreshes silently —
        // users only care about the real session lifetime.
        const refreshRemaining = payload.refreshExpiresAt
          ? Math.max(0, payload.refreshExpiresAt - Date.now())
          : 0
        if (refreshRemaining > 0) {
          setSessionStatus('active', refreshRemaining)
        } else {
          // Session expiry not available yet (first token detection, Angular hasn't
          // written the session expiry key to sessionStorage yet).
          // Show "active" without a countdown — next token event will have the real expiry.
          setSessionStatus('active', 0)
        }
      }),
    )

    unsubs.push(
      bus.on('token:expiring', (payload) => {
        setSessionStatus('expiring', payload.remainingMs)
      }),
    )

    unsubs.push(
      bus.on('token:expired', () => {
        setSessionStatus('expired')
      }),
    )

    unsubs.push(
      bus.on('page:changed', (payload) => {
        // Auto-expand on login or registration pages
        if (payload.path.includes('/login') || payload.path.includes('/subjects/registration')) {
          expand()
        }
        // Clear module section when page changes; the newly activated module will re-set it
        if (moduleSection) {
          while (moduleSection.firstChild) moduleSection.removeChild(moduleSection.firstChild)
        }
      }),
    )

    unsubs.push(
      bus.on('module:error', (payload) => {
        const errMsg =
          payload.error instanceof Error ? payload.error.message : String(payload.error)
        addMessage('error', `[${payload.moduleId}] ${errMsg}`)
      }),
    )
  }

  // --- Auto-expand on initial load for relevant pages ---
  function autoExpandOnLoad(): void {
    const path = window.location.pathname
    if (path.includes('/login') || path.includes('/subjects/registration')) {
      expand()
    }
  }

  // --- Init ---
  build()
  subscribe()
  autoExpandOnLoad()

  return {
    setSessionStatus,
    addMessage,
    setVersionWarning,
    setModuleContent,
    setModuleContentElement,
    expand,
    collapse,
    toggle,
    isExpanded: isExpandedFn,
    getCourseRushMode,
    setCourseRushMode: setCourseRushModeValue,
    getExamRushMode,
    setExamRushMode: setExamRushModeValue,
    getThemeSettings: () => ({ ...themeSettings }),
    setThemeSettings: (settings: ThemeSettings) => {
      themeSettings = { ...settings }
    },
    onThemeSettingsChange: (cb: (settings: ThemeSettings) => void) => {
      themeChangeCallbacks.push(cb)
      return () => {
        const idx = themeChangeCallbacks.indexOf(cb)
        if (idx >= 0) themeChangeCallbacks.splice(idx, 1)
      }
    },
    dispose,
  }
}
