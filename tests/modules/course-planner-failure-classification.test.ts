// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import { enrollPlannedCourses } from '../../src/modules/course-store/planner-enroll'
import { setApi } from '../../src/modules/course-store/state'

/**
 * Observed on a live Neptun instance with registration closed: every enrollment
 * answered HTTP 500 with the notification "Jelenleg nincs tárgyjelentkezési
 * időszak!". Treating 5xx as transient retried each subject three times, so two
 * planned subjects produced six submissions against an already-loaded server.
 *
 * Neptun does not use status codes semantically, so these tests pin that the
 * notification text is what decides whether an attempt is repeated.
 */

function createMockApi(): ModuleApi {
  return {
    bus: { emit: vi.fn(), on: vi.fn(() => () => {}), off: vi.fn() },
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      getForDomain: vi.fn(async () => undefined),
      setForDomain: vi.fn(async () => {}),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
            <mat-expansion-panel-header>Quantum ABC12DE345</mat-expansion-panel-header>
            <div class="course-list-item-container course-list-item-container--selected">
              <mat-checkbox>
                <label><input type="checkbox" checked><span class="mdc-label">E</span></label>
              </mat-checkbox>
            </div>
            <button class="enroll-first">Enroll subject</button>
          </mat-expansion-panel>
        </neptun-subject-list-item>
        <neptun-subject-list-item>
          <mat-expansion-panel class="mat-expanded">
            <mat-expansion-panel-header>Mobile XYZ98FG765</mat-expansion-panel-header>
            <div class="course-list-item-container course-list-item-container--selected">
              <mat-checkbox>
                <label><input type="checkbox" checked><span class="mdc-label">EA</span></label>
              </mat-checkbox>
            </div>
            <button class="enroll-second">Enroll subject</button>
          </mat-expansion-panel>
        </neptun-subject-list-item>
      </neptun-timetable-planner-list-view>
    </neptun-timetable-planner>
  `
}

function showNotification(text: string): void {
  let host = document.querySelector('.cdk-overlay-pane')
  if (!host) {
    host = document.createElement('div')
    host.className = 'cdk-overlay-pane'
    document.body.appendChild(host)
  }
  host.textContent = text
}

describe('enrollment failure classification', () => {
  let api: ModuleApi

  beforeEach(() => {
    document.body.innerHTML = plannerFixture()
    sessionStorage.setItem('access_token', 'test-token')
    api = createMockApi()
    setApi(api)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setApi(null)
    sessionStorage.clear()
    document.body.innerHTML = ''
  })

  function wireButtons(status: number, notification: string, clicks: string[]): void {
    const requests: PerformanceResourceTiming[] = []
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(
      () => requests as PerformanceEntryList,
    )

    for (const [selector, code] of [
      ['.enroll-first', 'ABC12DE345'],
      ['.enroll-second', 'XYZ98FG765'],
    ] as const) {
      document.querySelector<HTMLButtonElement>(selector)?.addEventListener('click', () => {
        clicks.push(code)
        requests.push({
          name: 'https://example.test/SubjectApplication/SubjectSignin',
          startTime: performance.now(),
          responseStatus: status,
        } as PerformanceResourceTiming)
        showNotification(notification)
      })
    }
  }

  it('stops the whole run when Neptun says there is no registration period', async () => {
    const clicks: string[] = []
    wireButtons(500, 'Sikertelen Jelenleg nincs tárgyjelentkezési időszak!', clicks)

    const result = await enrollPlannedCourses()

    // One click total: the condition is global, so the second subject is never tried.
    expect(clicks).toEqual(['ABC12DE345'])
    expect(result.aborted).toBe(true)
    expect(result.enrolled).toBe(0)
  })

  it('does not retry a 500 that carries a business-rule rejection', async () => {
    const clicks: string[] = []
    wireButtons(500, 'Sikertelen: a kurzus létszámkorlátja betelt.', clicks)

    await enrollPlannedCourses()

    // One click per subject, not three.
    expect(clicks).toEqual(['ABC12DE345', 'XYZ98FG765'])
  })

  // Slower than the default budget on purpose: with no notification to read,
  // each attempt spends the full settle window waiting for one.
  it('still retries a genuinely transient status with no explanation', async () => {
    const clicks: string[] = []
    wireButtons(503, '', clicks)

    await enrollPlannedCourses()

    expect(clicks.filter((code) => code === 'ABC12DE345')).toHaveLength(3)
  }, 20_000)

  /**
   * Neptun 2026.2.11 renders result toasts in its own `neptun-push-notifications`
   * component, which carries no `aria-live` and lives in no overlay pane.
   * Verified live on 2026-08-26: the previous Material selectors matched nothing,
   * so every failure lost its explanation. A real run then clicked all six
   * planned subjects with registration closed instead of stopping at the first,
   * and Course Rush disabled itself afterwards with nothing enrolled.
   */
  it('reads the run-fatal reason from the 2026.2.11 push-notification host', async () => {
    const clicks: string[] = []
    const requests: PerformanceResourceTiming[] = []
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(
      () => requests as PerformanceEntryList,
    )

    for (const [selector, code] of [
      ['.enroll-first', 'ABC12DE345'],
      ['.enroll-second', 'XYZ98FG765'],
    ] as const) {
      document.querySelector<HTMLButtonElement>(selector)?.addEventListener('click', () => {
        clicks.push(code)
        requests.push({
          name: 'https://example.test/SubjectApplication/SubjectSignin',
          startTime: performance.now(),
          responseStatus: 500,
        } as PerformanceResourceTiming)

        // The live host carries the wrapper class on the element itself.
        let host = document.querySelector('neptun-push-notifications')
        if (!host) {
          host = document.createElement('neptun-push-notifications')
          host.className = 'push-notifications'
          document.body.appendChild(host)
        }
        host.textContent = 'Sikertelen Jelenleg nincs tárgyjelentkezési időszak!'
      })
    }

    const result = await enrollPlannedCourses()

    expect(clicks).toEqual(['ABC12DE345'])
    expect(result.aborted).toBe(true)
    expect(result.enrolled).toBe(0)
  })
})
