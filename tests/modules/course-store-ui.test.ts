// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import { renderModuleUI } from '../../src/modules/course-store/ui'
import { setApi } from '../../src/modules/course-store/state'

function createMockApi(selections?: Record<string, string[]>): ModuleApi {
  return {
    bus: {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
      off: vi.fn(),
    },
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      getForDomain: async <T>(key: string) =>
        (key === 'courseSelections' ? selections : undefined) as T | undefined,
      setForDomain: vi.fn(async () => {}),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    statusPanel: {
      setSessionStatus: vi.fn(),
      addMessage: vi.fn(),
      setVersionWarning: vi.fn(),
      setModuleContent: vi.fn(),
      setModuleContentElement: vi.fn(),
      expand: vi.fn(),
      collapse: vi.fn(),
      toggle: vi.fn(),
      isExpanded: vi.fn(() => false),
      getCourseRushMode: vi.fn(() => false),
      setCourseRushMode: vi.fn(),
      getExamRushMode: vi.fn(() => false),
      setExamRushMode: vi.fn(),
      getThemeSettings: vi.fn(() => ({ enabled: false, color: 'pink' })),
      setThemeSettings: vi.fn(),
      onThemeSettingsChange: vi.fn(() => () => {}),
      dispose: vi.fn(),
    },
  }
}

function renderedContent(api: ModuleApi): HTMLElement {
  const mock = vi.mocked(api.statusPanel.setModuleContentElement)
  return mock.mock.calls.at(-1)?.[0] as HTMLElement
}

function buttonLabels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('button')).map(
    (button) => button.textContent?.trim() ?? '',
  )
}

describe('course-store planner-first UI', () => {
  afterEach(() => {
    setApi(null)
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('always exposes planner preview and enrollment even without local saves', async () => {
    const api = createMockApi()
    setApi(api)

    await renderModuleUI()

    const content = renderedContent(api)
    expect(buttonLabels(content)).toEqual([
      'Preview Planner',
      'Enroll Planner',
      'Clear Preview',
      'Save Local',
    ])
    expect(content.textContent).toContain('Disable Neptun’s own registration popup first')
    expect(content.textContent).toContain('Local buttons are the fallback')
  })

  it('labels the existing saved-selection enrollment as a local fallback', async () => {
    const api = createMockApi({ BMEVIAUAC00: ['A1'] })
    setApi(api)

    await renderModuleUI()

    const content = renderedContent(api)
    expect(buttonLabels(content)).toContain('Local Load + Enroll')
    expect(buttonLabels(content)).toContain('Preview Saved')
    expect(buttonLabels(content)).toContain('Clear Saved')
  })
})
