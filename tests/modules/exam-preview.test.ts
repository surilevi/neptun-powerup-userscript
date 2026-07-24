// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import { clearExamPreview, previewSavedExams } from '../../src/modules/exam-signup/preview'
import { setApi, setCachedSubjectCode } from '../../src/modules/exam-signup/state'

function createMockApi(): ModuleApi {
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
      getForDomain: async <T>(key: string): Promise<T | undefined> => {
        const value =
          key === 'examPreferences'
            ? {
                ABC12DE345: {
                  date: '2026. június 8. 8:00',
                  type: 'Írásbeli',
                  courseCode: 'E1',
                },
                BMEVITMAD01: {
                  date: '2026. június 9. 8:00',
                  type: 'Szóbeli',
                  courseCode: 'V1',
                },
                MISSING12: {
                  date: '2026. június 10. 8:00',
                  type: 'Írásbeli',
                  courseCode: '',
                },
              }
            : undefined
        return value as T | undefined
      },
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

describe('exam safe preview', () => {
  let api: ModuleApi

  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = `
      <main>
        <p>ABC12DE345</p>
        <table>
          <tr>
            <td>2026. június 8. 8:00</td>
            <td>Írásbeli</td>
            <td>0 / 20</td>
            <td>Teacher</td>
            <td>E1</td>
            <td><button>Felvétel</button></td>
          </tr>
          <tr>
            <td>2026. június 8. 8:00</td>
            <td>Írásbeli</td>
            <td>0 / 20</td>
            <td>Teacher</td>
            <td>E2</td>
            <td><button>Felvétel</button></td>
          </tr>
        </table>
        <p>BMEVITMAD01</p>
        <table>
          <tr>
            <td>2026. június 9. 8:00</td>
            <td>Szóbeli</td>
            <td>20 / 20</td>
            <td>Teacher</td>
            <td>V1</td>
            <td><button disabled>Felvétel</button></td>
          </tr>
        </table>
      </main>
    `
    api = createMockApi()
    setApi(api)
    setCachedSubjectCode(undefined)
  })

  afterEach(() => {
    setCachedSubjectCode(undefined)
    setApi(null)
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('highlights saved exam matches and enrollment targets without clicking', async () => {
    const clickSpy = vi.fn()
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', clickSpy)
    })

    const result = await previewSavedExams()

    expect(result).toMatchObject({
      savedExams: 3,
      matchedExams: 2,
      availableExams: 1,
      matchedRows: 3,
      enrollmentButtons: 3,
      availableEnrollmentButtons: 2,
    })
    expect(result.missing).toContain(
      'BMEVITMAD01: 2026. június 9. 8:00 has no available enrollment button',
    )
    expect(result.missing).toContain('MISSING12: 2026. június 10. 8:00 not visible')
    expect(document.querySelectorAll('[data-npu-exam-preview="row"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-npu-exam-preview="enrollment-button"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-npu-exam-preview="unavailable-row"]')).toHaveLength(1)
    expect(
      document.querySelectorAll('[data-npu-exam-preview="unavailable-enrollment-button"]'),
    ).toHaveLength(1)
    expect(clickSpy).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('No clicks were made.'),
    )
  })

  it('clears preview markers without removing exam rows', async () => {
    await previewSavedExams()
    const rowCount = document.querySelectorAll('tr').length

    clearExamPreview()

    expect(document.querySelector('[data-npu-exam-preview]')).toBeNull()
    expect(document.querySelectorAll('tr')).toHaveLength(rowCount)
  })
})
