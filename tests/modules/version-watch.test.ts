// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../../src/core/event-bus'
import { createLogger } from '../../src/core/logger'
import type { ModuleApi } from '../../src/types/modules'
import {
  findNeptunVersion,
  parseNeptunVersionText,
  versionWatchModule,
} from '../../src/modules/version-watch'

function createMockApi(initialState?: unknown): ModuleApi {
  let state = initialState

  return {
    bus: createEventBus(),
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      getForDomain: vi.fn(
        async (_key: string) => state,
      ) as unknown as ModuleApi['storage']['getForDomain'],
      setForDomain: vi.fn(async (_key: string, value: unknown) => {
        state = value
      }) as unknown as ModuleApi['storage']['setForDomain'],
    },
    logger: createLogger('version-watch'),
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

describe('version-watch module', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    versionWatchModule.dispose?.()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('parses the live Neptun footer version format', () => {
    expect(parseNeptunVersionText('Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)')).toEqual({
      raw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
      version: '2025.3.28',
      buildTime: '2026. 05. 20. 15:14:52',
    })
  })

  it('finds the footer version by the live selector', () => {
    document.body.innerHTML = `
      <footer class="footer">
        <div class="footer__version ng-star-inserted">
          Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)
        </div>
      </footer>
    `

    expect(findNeptunVersion()?.raw).toBe('Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)')
  })

  it('stores the first seen version silently', async () => {
    document.body.innerHTML =
      '<div class="footer__version">Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)</div>'
    const api = createMockApi()

    await versionWatchModule.initialize(api)

    expect(api.storage.setForDomain).toHaveBeenCalledWith(
      'versionWatch',
      expect.objectContaining({
        lastSeenRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
        acknowledgedRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
      }),
    )
    expect(api.statusPanel.setVersionWarning).not.toHaveBeenCalledWith(expect.any(Object))
  })

  it('warns when the semantic version changes', async () => {
    document.body.innerHTML =
      '<div class="footer__version">Verzió: 2025.3.29 (2026. 05. 21. 08:00:00)</div>'
    const api = createMockApi({
      lastSeenRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
      lastSeenVersion: '2025.3.28',
      acknowledgedRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
    })

    await versionWatchModule.initialize(api)

    expect(api.statusPanel.setVersionWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Neptun version changed',
        previous: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
        current: 'Verzió: 2025.3.29 (2026. 05. 21. 08:00:00)',
      }),
    )
    expect(api.statusPanel.expand).toHaveBeenCalled()
  })

  it('uses a softer warning when only the build timestamp changes', async () => {
    document.body.innerHTML =
      '<div class="footer__version">Verzió: 2025.3.28 (2026. 05. 21. 08:00:00)</div>'
    const api = createMockApi({
      lastSeenRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
      lastSeenVersion: '2025.3.28',
      acknowledgedRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
    })

    await versionWatchModule.initialize(api)

    expect(api.statusPanel.setVersionWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Neptun build changed',
        detail: 'Quick smoke test recommended.',
      }),
    )
  })

  it('acknowledges the current version from the warning action', async () => {
    document.body.innerHTML =
      '<div class="footer__version">Verzió: 2025.3.29 (2026. 05. 21. 08:00:00)</div>'
    const api = createMockApi({
      lastSeenRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
      lastSeenVersion: '2025.3.28',
      acknowledgedRaw: 'Verzió: 2025.3.28 (2026. 05. 20. 15:14:52)',
    })

    await versionWatchModule.initialize(api)
    const warning = vi.mocked(api.statusPanel.setVersionWarning).mock.calls[0][0]
    await warning?.onAction()

    expect(api.storage.setForDomain).toHaveBeenLastCalledWith(
      'versionWatch',
      expect.objectContaining({
        acknowledgedRaw: 'Verzió: 2025.3.29 (2026. 05. 21. 08:00:00)',
      }),
    )
    expect(api.statusPanel.setVersionWarning).toHaveBeenLastCalledWith(null)
  })
})
