import { describe, it, expect } from 'vitest'
import { THEME_PRESETS, DEFAULT_THEME } from '../../src/modules/pink-mode'

describe('THEME_PRESETS', () => {
  it('has exactly 5 presets', () => {
    expect(THEME_PRESETS).toHaveLength(5)
  })

  it('each preset has all 7 required color fields', () => {
    const requiredFields = ['primary', 'dark', 'light', 'bgTint', 'link', 'tableHeader', 'footerText']
    for (const preset of THEME_PRESETS) {
      for (const field of requiredFields) {
        expect(preset).toHaveProperty(field)
        expect((preset as unknown as Record<string, string>)[field]).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('each preset has a unique key', () => {
    const keys = THEME_PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('DEFAULT_THEME uses a valid preset key', () => {
    const keys = THEME_PRESETS.map((p) => p.key)
    expect(keys).toContain(DEFAULT_THEME.color)
  })

  it('DEFAULT_THEME is disabled by default', () => {
    expect(DEFAULT_THEME.enabled).toBe(false)
  })
})
