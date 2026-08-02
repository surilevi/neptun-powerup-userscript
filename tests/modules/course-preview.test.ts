// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import {
  clearCoursePreview,
  previewPlannedCourses,
  previewSavedCourses,
} from '../../src/modules/course-store/preview'
import { setApi } from '../../src/modules/course-store/state'

type CourseSelections = Record<string, string[]>

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

function setStoredCourses(api: ModuleApi, selections: CourseSelections): void {
  api.storage.getForDomain = async <T>(key: string): Promise<T | undefined> =>
    (key === 'courseSelections' ? selections : undefined) as T | undefined
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
      expect.stringContaining('No course selections or enrollment buttons were clicked.'),
    )
  })

  it('expands a collapsed subject only to reveal its lazy-rendered preview targets', async () => {
    document.body.innerHTML = `
      <mat-expansion-panel>
        <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
      </mat-expansion-panel>
    `
    const panel = document.querySelector('mat-expansion-panel')
    const header = document.querySelector('mat-expansion-panel-header')
    const headerClickSpy = vi.fn()
    const enrollmentClickSpy = vi.fn()

    header?.addEventListener('click', () => {
      headerClickSpy()
      panel?.classList.add('mat-expanded')
      panel?.insertAdjacentHTML(
        'beforeend',
        `
          <div class="course-list-item-container">
            <mat-checkbox><label><span class="mdc-label">NE1</span></label></mat-checkbox>
          </div>
          <button>Tárgy felvétele</button>
        `,
      )
      panel?.querySelector('button')?.addEventListener('click', enrollmentClickSpy)
    })

    const result = await previewSavedCourses()

    expect(headerClickSpy).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      matchedSubjects: 1,
      matchedCourses: 1,
      enrollmentButtons: 1,
      availableEnrollmentButtons: 1,
    })
    expect(document.querySelector('[data-npu-course-preview="course"]')).not.toBeNull()
    expect(document.querySelector('[data-npu-course-preview="enrollment-button"]')).not.toBeNull()
    expect(enrollmentClickSpy).not.toHaveBeenCalled()
  })

  it('clears preview markers without removing page elements', async () => {
    await previewSavedCourses()
    const panelCount = document.querySelectorAll('mat-expansion-panel').length

    clearCoursePreview()

    expect(document.querySelector('[data-npu-course-preview]')).toBeNull()
    expect(document.querySelectorAll('mat-expansion-panel')).toHaveLength(panelCount)
  })

  it('clears stale markers and reports an empty saved set without touching controls', async () => {
    await previewSavedCourses()
    setStoredCourses(api, {})
    const clickSpy = vi.fn()
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', clickSpy)
    })

    const result = await previewSavedCourses()

    expect(result).toEqual({
      savedSubjects: 0,
      matchedSubjects: 0,
      savedCourses: 0,
      matchedCourses: 0,
      selectedCourses: 0,
      enrollmentButtons: 0,
      availableEnrollmentButtons: 0,
      missing: [],
    })
    expect(document.querySelector('[data-npu-course-preview]')).toBeNull()
    expect(clickSpy).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenLastCalledWith(
      'info',
      expect.stringContaining('No saved courses to preview'),
    )
  })

  it('does not confuse a saved course code with a longer visible prefix match', async () => {
    setStoredCourses(api, { ABC12DE345: ['NE1'] })
    document.body.innerHTML = `
      <mat-expansion-panel class="mat-expanded">
        <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
        <div class="course-list-item-container">
          <mat-checkbox><label><span class="mdc-label">NE10</span></label></mat-checkbox>
        </div>
        <button>Enroll subject</button>
      </mat-expansion-panel>
    `

    const result = await previewSavedCourses()

    expect(result.matchedCourses).toBe(0)
    expect(result.missing).toContain('ABC12DE345: NE1 not visible')
    expect(document.querySelector('[data-npu-course-preview="course"]')).toBeNull()
  })

  it('marks an enrollment button inside a hidden ancestor as unavailable', async () => {
    setStoredCourses(api, { ABC12DE345: ['NE1'] })
    document.body.innerHTML = `
      <mat-expansion-panel class="mat-expanded">
        <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
        <div class="course-list-item-container">
          <mat-checkbox><label><span class="mdc-label">NE1</span></label></mat-checkbox>
        </div>
        <div aria-hidden="true"><button>Enroll subject</button></div>
      </mat-expansion-panel>
    `

    const result = await previewSavedCourses()

    expect(result.enrollmentButtons).toBe(1)
    expect(result.availableEnrollmentButtons).toBe(0)
    expect(
      document.querySelector('[data-npu-course-preview="unavailable-enrollment-button"]'),
    ).not.toBeNull()
  })

  it('reports a panel that fails to expand and never clicks its inner controls', async () => {
    vi.useFakeTimers()
    try {
      setStoredCourses(api, { ABC12DE345: ['NE1'] })
      document.body.innerHTML = `
        <mat-expansion-panel>
          <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
          <button>Enroll subject</button>
        </mat-expansion-panel>
      `
      const headerClickSpy = vi.fn()
      const enrollmentClickSpy = vi.fn()
      document
        .querySelector('mat-expansion-panel-header')
        ?.addEventListener('click', headerClickSpy)
      document.querySelector('button')?.addEventListener('click', enrollmentClickSpy)

      const preview = previewSavedCourses()
      await vi.advanceTimersByTimeAsync(6_000)
      const result = await preview

      expect(headerClickSpy).toHaveBeenCalledOnce()
      expect(enrollmentClickSpy).not.toHaveBeenCalled()
      expect(result.missing).toContain('ABC12DE345: subject panel could not be expanded')
      expect(result.enrollmentButtons).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces overlapping preview requests so a lazy panel is expanded only once', async () => {
    setStoredCourses(api, { ABC12DE345: ['NE1'] })
    document.body.innerHTML = `
      <mat-expansion-panel>
        <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
      </mat-expansion-panel>
    `
    const panel = document.querySelector('mat-expansion-panel')
    const header = document.querySelector('mat-expansion-panel-header')
    const headerClickSpy = vi.fn()
    header?.addEventListener('click', () => {
      headerClickSpy()
      panel?.classList.add('mat-expanded')
      panel?.insertAdjacentHTML(
        'beforeend',
        `
          <div class="course-list-item-container">
            <mat-checkbox><label><span class="mdc-label">NE1</span></label></mat-checkbox>
          </div>
          <button>Enroll subject</button>
        `,
      )
    })

    const first = previewSavedCourses()
    const second = previewSavedCourses()

    expect(second).toBe(first)
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult).toBe(firstResult)
    expect(headerClickSpy).toHaveBeenCalledOnce()
  })

  it('previews the Neptun planner queue without changing course or planner selections', async () => {
    document.body.innerHTML = `
      <button class="timetable-planner__toggle-button" aria-label="Close timetable planner">
        Timetable planner
      </button>
      <neptun-timetable-planner>
        <neptun-timetable-planner-list-view>
          <neptun-subject-list-item>
            <mat-expansion-panel class="mat-expanded">
              <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
              <div class="course-list-item-container course-list-item-container--selected">
                <mat-checkbox>
                  <label><input type="checkbox" checked><span class="mdc-label">NE1</span></label>
                </mat-checkbox>
                <button class="planner-state">Added to planner</button>
              </div>
              <button class="enroll">Enroll subject</button>
            </mat-expansion-panel>
          </neptun-subject-list-item>
          <neptun-subject-list-item>
            <mat-expansion-panel class="mat-expanded">
              <mat-expansion-panel-header>Automation BMEVIAUAC00</mat-expansion-panel-header>
              <div class="course-list-item-container course-list-item-container--selected">
                <mat-checkbox>
                  <label><input type="checkbox" checked><span class="mdc-label">A1</span></label>
                </mat-checkbox>
              </div>
              <button>Drop subject</button>
            </mat-expansion-panel>
          </neptun-subject-list-item>
        </neptun-timetable-planner-list-view>
      </neptun-timetable-planner>
    `
    const courseSelectionClickSpy = vi.fn()
    const plannerSelectionClickSpy = vi.fn()
    const enrollmentClickSpy = vi.fn()
    document.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('click', courseSelectionClickSpy)
    })
    document.querySelector('.planner-state')?.addEventListener('click', plannerSelectionClickSpy)
    document.querySelector('.enroll')?.addEventListener('click', enrollmentClickSpy)

    const result = await previewPlannedCourses()

    expect(result).toMatchObject({
      plannedSubjects: 2,
      plannedCourses: 2,
      enrollableSubjects: 1,
      unavailableSubjects: 1,
      openedPlanner: false,
      switchedToList: false,
    })
    expect(result.issues).toContain(
      'BMEVIAUAC00: already registered or enrollment action unavailable',
    )
    expect(document.querySelectorAll('[data-npu-course-preview="selected-course"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-npu-course-preview="enrollment-button"]')).toHaveLength(
      1,
    )
    expect(
      document.querySelectorAll('[data-npu-course-preview="unavailable-subject"]'),
    ).toHaveLength(1)
    expect(courseSelectionClickSpy).not.toHaveBeenCalled()
    expect(plannerSelectionClickSpy).not.toHaveBeenCalled()
    expect(enrollmentClickSpy).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('No course, planner-selection, or enrollment controls were clicked.'),
    )
  })
})
