// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import { enrollPlannedCourses } from '../../src/modules/course-store/planner-enroll'
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
      getForDomain: vi.fn(async () => undefined),
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

function plannerFixture(): string {
  return `
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
            </div>
            <button class="enroll-first">Enroll subject</button>
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
            <button class="enroll-second">Enroll subject</button>
          </mat-expansion-panel>
        </neptun-subject-list-item>
      </neptun-timetable-planner-list-view>
    </neptun-timetable-planner>
  `
}

describe('planner-first course enrollment', () => {
  let api: ModuleApi

  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = plannerFixture()
    sessionStorage.setItem('access_token', 'test-token')
    api = createMockApi()
    setApi(api)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setApi(null)
    sessionStorage.clear()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('clicks only visible enrollment actions sequentially and verifies each UI update', async () => {
    const requests: PerformanceResourceTiming[] = []
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(
      () => requests as PerformanceEntryList,
    )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const clickOrder: string[] = []
    const checkboxClickSpy = vi.fn()
    document.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('click', checkboxClickSpy)
    })

    const firstButton = document.querySelector<HTMLButtonElement>('.enroll-first')
    const secondButton = document.querySelector<HTMLButtonElement>('.enroll-second')
    firstButton?.addEventListener('click', () => {
      clickOrder.push('ABC12DE345')
      requests.push({
        name: 'https://example.test/SubjectApplication/SubjectSignin',
        startTime: performance.now(),
        responseStatus: 200,
      } as PerformanceResourceTiming)
      firstButton.remove()
    })
    secondButton?.addEventListener('click', () => {
      clickOrder.push('BMEVIAUAC00')
      requests.push({
        name: 'https://example.test/SubjectApplication/SubjectSignin',
        startTime: performance.now(),
        responseStatus: 200,
      } as PerformanceResourceTiming)
      secondButton.remove()
    })

    const result = await enrollPlannedCourses()

    expect(result).toMatchObject({
      plannedSubjects: 2,
      eligibleSubjects: 2,
      attempted: 2,
      enrolled: 2,
      failed: 0,
      skipped: 0,
      aborted: false,
    })
    expect(clickOrder).toEqual(['ABC12DE345', 'BMEVIAUAC00'])
    expect(checkboxClickSpy).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenLastCalledWith(
      'info',
      expect.stringContaining('2 enrolled, 0 failed'),
    )
  })

  it('stops after Neptun opens its own registration confirmation popup', async () => {
    const staleRequest = {
      name: 'https://example.test/SubjectApplication/SubjectSignin',
      startTime: 1,
      responseStatus: 200,
    } as PerformanceResourceTiming
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      staleRequest,
    ] as PerformanceEntryList)
    const firstClickSpy = vi.fn()
    const secondClickSpy = vi.fn()
    document.querySelector('.enroll-first')?.addEventListener('click', () => {
      firstClickSpy()
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div role="dialog"><p>Confirm subject registration</p><button>OK</button></div>',
      )
    })
    document.querySelector('.enroll-second')?.addEventListener('click', secondClickSpy)

    const result = await enrollPlannedCourses()

    expect(result).toMatchObject({
      attempted: 1,
      enrolled: 0,
      failed: 1,
      aborted: true,
    })
    expect(result.errors).toContain('ABC12DE345: Neptun registration confirmation popup is enabled')
    expect(firstClickSpy).toHaveBeenCalledOnce()
    expect(secondClickSpy).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('enable “do not show again,” then retry'),
    )
  })

  it('continues after a Neptun notification and a subject-level failure', async () => {
    vi.useFakeTimers()
    const requests: PerformanceResourceTiming[] = []
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(
      () => requests as PerformanceEntryList,
    )
    const clickOrder: string[] = []
    const firstButton = document.querySelector<HTMLButtonElement>('.enroll-first')
    const secondButton = document.querySelector<HTMLButtonElement>('.enroll-second')
    firstButton?.addEventListener('click', () => {
      clickOrder.push('ABC12DE345')
      requests.push({
        name: 'https://example.test/SubjectApplication/SubjectSignin',
        startTime: performance.now(),
        responseStatus: 200,
      } as PerformanceResourceTiming)
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="cdk-overlay-pane" role="dialog"><section>Értesítések – Sikertelen</section><button>Összes értesítés megnyitása</button></div>',
      )
    })
    secondButton?.addEventListener('click', () => {
      clickOrder.push('BMEVIAUAC00')
      requests.push({
        name: 'https://example.test/SubjectApplication/SubjectSignin',
        startTime: performance.now(),
        responseStatus: 200,
      } as PerformanceResourceTiming)
      secondButton.remove()
    })

    try {
      const enrollment = enrollPlannedCourses()
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await enrollment

      expect(result).toMatchObject({
        attempted: 2,
        enrolled: 1,
        failed: 1,
        aborted: false,
      })
      expect(clickOrder).toEqual(['ABC12DE345', 'BMEVIAUAC00'])
      expect(result.errors).toContain('ABC12DE345: Neptun reported enrollment failure')
    } finally {
      vi.useRealTimers()
    }
  })

  it('revalidates every target and skips a later subject whose courses changed', async () => {
    const requests: PerformanceResourceTiming[] = []
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(
      () => requests as PerformanceEntryList,
    )
    const firstClickSpy = vi.fn()
    const secondClickSpy = vi.fn()
    const firstButton = document.querySelector<HTMLButtonElement>('.enroll-first')
    const secondCheckbox = document.querySelector<HTMLInputElement>(
      'neptun-subject-list-item:nth-of-type(2) input[type="checkbox"]',
    )
    firstButton?.addEventListener('click', () => {
      firstClickSpy()
      requests.push({
        name: 'https://example.test/SubjectApplication/SubjectSignin',
        startTime: performance.now(),
        responseStatus: 200,
      } as PerformanceResourceTiming)
      firstButton.remove()
      if (secondCheckbox) secondCheckbox.checked = false
      secondCheckbox
        ?.closest('.course-list-item-container')
        ?.classList.remove('course-list-item-container--selected')
    })
    document.querySelector('.enroll-second')?.addEventListener('click', secondClickSpy)

    const result = await enrollPlannedCourses()

    expect(result).toMatchObject({
      attempted: 1,
      enrolled: 1,
      failed: 1,
      aborted: false,
    })
    expect(result.errors).toContain('BMEVIAUAC00: planner selection changed before enrollment')
    expect(firstClickSpy).toHaveBeenCalledOnce()
    expect(secondClickSpy).not.toHaveBeenCalled()
  })

  it('does not click enrollment when the Neptun session token is missing', async () => {
    sessionStorage.clear()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const enrollmentClickSpy = vi.fn()
    document.querySelectorAll('.enroll-first, .enroll-second').forEach((button) => {
      button.addEventListener('click', enrollmentClickSpy)
    })

    const result = await enrollPlannedCourses()

    expect(result.aborted).toBe(true)
    expect(result.errors).toContain('Session expired')
    expect(enrollmentClickSpy).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
