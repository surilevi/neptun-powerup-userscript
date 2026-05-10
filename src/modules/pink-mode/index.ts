import type { NpuModule, ModuleApi, PageContext } from '../../types/modules'

const STYLE_ID = 'npu-theme-mode'

export interface ThemePreset {
  name: string
  key: string
  primary: string
  dark: string
  light: string
  bgTint: string
  link: string
  tableHeader: string
  footerText: string
}

export const THEME_PRESETS: ThemePreset[] = [
  { name: 'Pink', key: 'pink', primary: '#e91e63', dark: '#880e4f', light: '#f48fb1', bgTint: '#fdf2f6', link: '#c2185b', tableHeader: '#ec407a', footerText: '#fce4ec' },
  { name: 'Purple', key: 'purple', primary: '#9c27b0', dark: '#4a148c', light: '#ce93d8', bgTint: '#f3e5f5', link: '#7b1fa2', tableHeader: '#ab47bc', footerText: '#e1bee7' },
  { name: 'Teal', key: 'teal', primary: '#009688', dark: '#004d40', light: '#80cbc4', bgTint: '#e0f2f1', link: '#00796b', tableHeader: '#26a69a', footerText: '#b2dfdb' },
  { name: 'Orange', key: 'orange', primary: '#ff5722', dark: '#bf360c', light: '#ffab91', bgTint: '#fbe9e7', link: '#e64a19', tableHeader: '#ff7043', footerText: '#ffccbc' },
  { name: 'Red', key: 'red', primary: '#f44336', dark: '#b71c1c', light: '#ef9a9a', bgTint: '#ffebee', link: '#d32f2f', tableHeader: '#ef5350', footerText: '#ffcdd2' },
]

export interface ThemeSettings {
  enabled: boolean
  color: string
}

export const DEFAULT_THEME: ThemeSettings = { enabled: false, color: 'pink' }

const THEME_CSS = `
/* NPU Theme Mode — accent colors via CSS custom properties */
/* Rule: ONLY color accents. Don't change backgrounds of content areas. */
/* Rule: NEVER touch #npu-status-root */

body:not(#npu-status-root) {
  background-color: var(--npu-bg-tint) !important;
}

neptun-header,
neptun-header header,
neptun-header .header,
neptun-header .header__inner {
  background-color: var(--npu-accent) !important;
  color: white !important;
}

footer {
  background-color: var(--npu-accent-dark) !important;
  color: var(--npu-footer-text) !important;
}

button[type="submit"],
button[color="primary"],
.mat-mdc-raised-button[color="primary"],
.mat-mdc-unelevated-button[color="primary"] {
  background-color: var(--npu-accent) !important;
  color: white !important;
}

table th,
.mat-mdc-header-cell {
  background-color: var(--npu-table-header) !important;
  color: white !important;
}

a:not(#npu-status-root a) {
  color: var(--npu-link) !important;
}

.mdc-checkbox--selected .mdc-checkbox__background {
  background-color: var(--npu-accent) !important;
  border-color: var(--npu-accent) !important;
}

mat-expansion-panel {
  border-left: 3px solid var(--npu-accent-light) !important;
}

::-webkit-scrollbar-thumb {
  background: var(--npu-accent-light) !important;
}

.mat-mdc-badge-content {
  background-color: var(--npu-accent) !important;
}
`

let api: ModuleApi | null = null
let styleElement: HTMLStyleElement | null = null
let unsubTheme: (() => void) | null = null

function getPreset(key: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.key === key) ?? THEME_PRESETS[0]
}

function setCustomProperties(preset: ThemePreset): void {
  const root = document.documentElement
  root.style.setProperty('--npu-accent', preset.primary)
  root.style.setProperty('--npu-accent-dark', preset.dark)
  root.style.setProperty('--npu-accent-light', preset.light)
  root.style.setProperty('--npu-bg-tint', preset.bgTint)
  root.style.setProperty('--npu-link', preset.link)
  root.style.setProperty('--npu-table-header', preset.tableHeader)
  root.style.setProperty('--npu-footer-text', preset.footerText)
}

function clearCustomProperties(): void {
  const root = document.documentElement
  root.style.removeProperty('--npu-accent')
  root.style.removeProperty('--npu-accent-dark')
  root.style.removeProperty('--npu-accent-light')
  root.style.removeProperty('--npu-bg-tint')
  root.style.removeProperty('--npu-link')
  root.style.removeProperty('--npu-table-header')
  root.style.removeProperty('--npu-footer-text')
}

function inject(preset: ThemePreset): void {
  setCustomProperties(preset)
  if (document.getElementById(STYLE_ID)) return
  styleElement = document.createElement('style')
  styleElement.id = STYLE_ID
  styleElement.textContent = THEME_CSS
  document.head.appendChild(styleElement)
}

function remove(): void {
  styleElement?.remove()
  styleElement = null
  document.getElementById(STYLE_ID)?.remove()
  clearCustomProperties()
}

export const pinkModeModule: NpuModule = {
  id: 'pink-mode',
  name: 'Theme',
  description: 'Color accent theme for Neptun',

  shouldActivate(_context: PageContext): boolean {
    return true
  },

  initialize(moduleApi: ModuleApi): void {
    api = moduleApi
    const settings = api.statusPanel.getThemeSettings()
    if (settings.enabled) {
      const preset = getPreset(settings.color)
      inject(preset)
      api.logger.info(`theme activated: ${preset.name}`)
    }

    // Listen for theme changes from settings panel (store unsub for dispose)
    unsubTheme = api.statusPanel.onThemeSettingsChange((newSettings) => {
      if (newSettings.enabled) {
        const preset = getPreset(newSettings.color)
        inject(preset)
        api?.logger.info(`theme changed to ${preset.name}`)
      } else {
        remove()
        api?.logger.info('theme deactivated')
      }
    })
  },

  dispose(): void {
    unsubTheme?.()
    unsubTheme = null
    remove()
    api = null
  },
}
