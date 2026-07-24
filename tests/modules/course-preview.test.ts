// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import { clearCoursePreview, previewSavedCourses } from '../../src/modules/course-store/preview'
import { setApi } from '../../src/modules/course-store/state'

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
          key === 'courseSelections'
            ? {
                ABC12DE345: ['NE1', 'NF1'],
                BMEVIAUAC00: ['A1'],
                MISSING12: ['G1'],
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

describe('course safe preview', () => {
  let api: ModuleApi

  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = `
      <mat-expansion-panel class="mat-expanded">
        <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
        <div class="course-list-item-container course-list-item-container--selected">
          <mat-checkbox><label><span class="mdc-label">NE1</span></label></mat-checkbox>
        </div>
        <div class="course-list-item-container">
          <mat-checkbox><label><span class="mdc-label">NF1</span></label></mat-checkbox>
        </div>
        <button>Tárgy felvétele</button>
      </mat-expansion-panel>
      <mat-expansion-panel class="mat-expanded">
        <mat-expansion-panel-header>Automation BMEVIAUAC00</mat-expansion-panel-header>
        <div class="course-list-item-container">
          <mat-checkbox><label><span class="mdc-label">A1</span></label></mat-checkbox>
        </div>
        <button aria-disabled="true">Tárgy felvétele</button>
      </mat-expansion-panel>
    `
    api = createMockApi()
    setApi(api)
  })

  afterEach(() => {
    setApi(null)
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('highlights exact saved matches and enrollment targets without clicking', async () => {
    const clickSpy = vi.fn()
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', clickSpy)
    })

    const result = await previewSavedCourses()

    expect(result).toMatchObject({
      savedSubjects: 3,
      matchedSubjects: 2,
      savedCourses: 4,
      matchedCourses: 3,
      selectedCourses: 1,
      enrollmentButtons: 2,
      availableEnrollmentButtons: 1,
    })
    expect(result.missing).toContain('BMEVIAUAC00: enrollment button unavailable')
    expect(result.missing).toContain('MISSING12: subject not visible')
    expect(document.querySelectorAll('[data-npu-course-preview="subject"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-npu-course-preview="course"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-npu-course-preview="selected-course"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-npu-course-preview="enrollment-button"]')).toHaveLength(
      1,
    )
    expect(
      document.querySelectorAll('[data-npu-course-preview="unavailable-enrollment-button"]'),
    ).toHaveLength(1)
    expect(clickSpy).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('No clicks were made.'),
    )
  })

  it('clears preview markers without removing page elements', async () => {
    await previewSavedCourses()
    const panelCount = document.querySelectorAll('mat-expansion-panel').length

    clearCoursePreview()

    expect(document.querySelector('[data-npu-course-preview]')).toBeNull()
    expect(document.querySelectorAll('mat-expansion-panel')).toHaveLength(panelCount)
  })
})
