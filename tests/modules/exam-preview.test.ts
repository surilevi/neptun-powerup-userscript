// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import { clearExamPreview, previewSavedExams } from '../../src/modules/exam-signup/preview'
import { setApi, setCachedSubjectCode } from '../../src/modules/exam-signup/state'

type ExamPreferences = Record<string, { date: string; type: string; courseCode: string }>

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

function setStoredExams(api: ModuleApi, preferences: ExamPreferences): void {
  api.storage.getForDomain = async <T>(key: string): Promise<T | undefined> =>
    (key === 'examPreferences' ? preferences : undefined) as T | undefined
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

  it('clears stale markers and reports an empty saved set without clicking', async () => {
    await previewSavedExams()
    setStoredExams(api, {})
    const clickSpy = vi.fn()
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', clickSpy)
    })

    const result = await previewSavedExams()

    expect(result).toEqual({
      savedExams: 0,
      matchedExams: 0,
      availableExams: 0,
      matchedRows: 0,
      enrollmentButtons: 0,
      availableEnrollmentButtons: 0,
      missing: [],
    })
    expect(document.querySelector('[data-npu-exam-preview]')).toBeNull()
    expect(clickSpy).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenLastCalledWith(
      'info',
      expect.stringContaining('No saved exams to preview'),
    )
  })

  it('treats enrollment controls inside hidden containers as unavailable', async () => {
    const visibleDate = document.querySelector('td')?.textContent?.trim() ?? ''
    setStoredExams(api, {
      ABC12DE345: {
        date: visibleDate,
        type: 'written',
        courseCode: 'E1',
      },
    })
    document.querySelector('table')?.setAttribute('hidden', '')

    const result = await previewSavedExams()

    expect(result).toMatchObject({
      matchedExams: 1,
      availableExams: 0,
      enrollmentButtons: 2,
      availableEnrollmentButtons: 0,
    })
    expect(document.querySelectorAll('[data-npu-exam-preview="unavailable-row"]')).toHaveLength(2)
    expect(
      document.querySelectorAll('[data-npu-exam-preview="unavailable-enrollment-button"]'),
    ).toHaveLength(2)
  })

  it('marks registered and full saved exam rows unavailable without finding an enroll action', async () => {
    setStoredExams(api, {
      ABC12DE345: {
        date: '2026. 06. 08. 08:00',
        type: 'written',
        courseCode: 'E1',
      },
      BMEVITMAD01: {
        date: '2026. 06. 09. 08:00',
        type: 'oral',
        courseCode: 'V1',
      },
    })
    document.body.innerHTML = `
      <main>
        <p>ABC12DE345</p>
        <table>
          <tr>
            <td>2026. 06. 08. 08:00 registered</td>
            <td>written</td><td>1 / 20</td><td>Teacher</td><td>E1</td>
            <td><button>Leadas</button></td>
          </tr>
        </table>
        <p>BMEVITMAD01</p>
        <table>
          <tr>
            <td>2026. 06. 09. 08:00 Betelt</td>
            <td>oral</td><td>20 / 20</td><td>Teacher</td><td>V1</td>
            <td><button>Details</button></td>
          </tr>
        </table>
      </main>
    `
    const clickSpy = vi.fn()
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', clickSpy)
    })

    const result = await previewSavedExams()

    expect(result).toMatchObject({
      savedExams: 2,
      matchedExams: 2,
      availableExams: 0,
      matchedRows: 2,
      enrollmentButtons: 0,
      availableEnrollmentButtons: 0,
    })
    expect(document.querySelectorAll('[data-npu-exam-preview="unavailable-row"]')).toHaveLength(2)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('requires an exact normalized saved date match', async () => {
    setStoredExams(api, {
      ABC12DE345: {
        date: '2026. 06. 08. 09:00',
        type: 'written',
        courseCode: 'E1',
      },
    })

    const result = await previewSavedExams()

    expect(result.matchedExams).toBe(0)
    expect(result.matchedRows).toBe(0)
    expect(document.querySelector('[data-npu-exam-preview]')).toBeNull()
  })

  it('coalesces overlapping preview requests', async () => {
    const first = previewSavedExams()
    const second = previewSavedExams()

    expect(second).toBe(first)
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult).toBe(firstResult)
    expect(api.statusPanel.addMessage).toHaveBeenCalledTimes(1)
  })
})
