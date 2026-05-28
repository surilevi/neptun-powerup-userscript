import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreferences } from '../../src/modules/exam-signup/storage'
import { setApi } from '../../src/modules/exam-signup/state'
import type { ModuleApi } from '../../src/types/modules'

function createMockApi(rawPrefs: unknown): ModuleApi {
  const getForDomain: ModuleApi['storage']['getForDomain'] = async <T>() => rawPrefs as T

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
      getForDomain,
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

describe('exam-signup storage', () => {
  afterEach(() => {
    setApi(null)
  })

  it('normalizes saved dates that include visible registration status text', async () => {
    setApi(
      createMockApi({
        BMEVESAA010: {
          date: '2026. június 4. 13:00 Felvéve',
          type: 'Írásbeli',
          courseCode: '10',
        },
      }),
    )

    await expect(loadPreferences()).resolves.toEqual({
      BMEVESAA010: {
        date: '2026. június 4. 13:00',
        type: 'Írásbeli',
        courseCode: '10',
      },
    })
  })
})
