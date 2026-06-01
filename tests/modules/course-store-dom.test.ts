// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import {
  autoSearchSubjects,
  extractCourseCode,
  extractSubjectCode,
  findSubjectPanel,
  isCourseSelected,
  isEnrollButtonText,
  waitForSubjectListing,
} from '../../src/modules/course-store/dom'
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

describe('course-store subject and course extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setApi(createMockApi())
  })

  afterEach(() => {
    setApi(null)
    document.body.innerHTML = ''
  })

  it('extracts a non-BME subject code from the expansion panel header', () => {
    const panel = document.createElement('mat-expansion-panel')
    panel.innerHTML = `
      <mat-expansion-panel-header>
        Data structures
        5 kredit
        Vizsga
        ABC12DE345-01
      </mat-expansion-panel-header>
      <div class="course-list-item-container">2xx_A1N</div>
    `

    expect(extractSubjectCode(panel)).toBe('ABC12DE345-01')
  })

  it('reads the checkbox label course code instead of the attendance type text', () => {
    const item = document.createElement('div')
    item.className = 'course-list-item-container'
    item.innerHTML = `
      <mat-checkbox>
        <label>
          <span class="mdc-label">2xx_A1N</span>
        </label>
      </mat-checkbox>
      <span>Minimalis letszam nem teljesul</span>
      <span>Jelenleti</span>
      <span>Tipus: Gyakorlat</span>
      <span>0 fo / 22 limit</span>
    `

    expect(extractCourseCode(item)).toBe('2XX_A1N')
  })

  it('does not extract the tail of Jelenleti before the Tipus label', () => {
    const item = document.createElement('div')
    item.textContent = 'Minimalis letszam nem teljesulJelenletiTipus: Gyakorlat0 fo / 22 limit'

    expect(extractCourseCode(item)).toBeNull()
  })

  it('falls back to a standalone text-node course code when no checkbox label exists', () => {
    const item = document.createElement('div')
    item.className = 'course-list-item-container'
    item.append('NE1')

    const details = document.createElement('span')
    details.textContent = 'Jelenleti Tipus: Gyakorlat'
    item.append(details)

    expect(extractCourseCode(item)).toBe('NE1')
  })

  it('extracts mixed-case course codes from the live checkbox heading format', () => {
    const item = document.createElement('div')
    item.className = 'course-list-item-container'
    item.innerHTML = `
      <div>
        <h6>cs14_SzintB1N</h6>
        <div>Csutortok 14:15-16:00</div>
      </div>
      <span>Minimalis letszam nem teljesul</span>
      <span>Jelenleti</span>
      <span>Gyakorlat</span>
    `

    expect(extractCourseCode(item)).toBe('CS14_SZINTB1N')
  })

  it('extracts short alphabetic checkbox labels such as E', () => {
    const item = document.createElement('div')
    item.className = 'course-list-item-container'
    item.innerHTML = `
      <mat-checkbox>
        <label>
          <span class="mdc-label">E</span>
        </label>
      </mat-checkbox>
      <span>Elmelet</span>
      <span>0 fo / 200 limit</span>
    `

    expect(extractCourseCode(item)).toBe('E')
  })

  it('extracts short alphabetic text-node labels such as AG without treating status text as a code', () => {
    const item = document.createElement('div')
    item.className = 'course-list-item-container'
    item.innerHTML = `
      <div>AG</div>
      <span>Gyakorlat</span>
      <span>0 fo / 10 limit</span>
    `

    expect(extractCourseCode(item)).toBe('AG')
  })

  it('finds a subject panel by its extracted subject code', () => {
    document.body.innerHTML = `
      <mat-expansion-panel>
        <mat-expansion-panel-header>
          Nemet nyelvi szintre hozo B1
          0 kredit
          Evkozi jegy
          BMEGT60LNGN301-01
        </mat-expansion-panel-header>
      </mat-expansion-panel>
    `

    expect(findSubjectPanel('BMEGT60LNGN301-01')).not.toBeNull()
  })

  it('treats a checked checkbox as selected even without the selected CSS class', () => {
    const item = document.createElement('div')
    item.className = 'course-list-item-container'
    item.innerHTML = '<input type="checkbox" checked aria-checked="true" />'

    expect(isCourseSelected(item)).toBe(true)
  })
})

describe('course-store button text detection', () => {
  it('recognizes Hungarian and English enroll button labels', () => {
    expect(isEnrollButtonText('Targy felvetele')).toBe(true)
    expect(isEnrollButtonText('Take subject')).toBe(true)
    expect(isEnrollButtonText('Enroll subject')).toBe(true)
    expect(isEnrollButtonText('Ment')).toBe(false)
  })
})

describe('course-store autoSearchSubjects', () => {
  let api: ModuleApi

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    api = createMockApi()
    setApi(api)
  })

  afterEach(() => {
    setApi(null)
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clicks a Hungarian search button that renders after a long delay', async () => {
    const clickSpy = vi.fn()
    const promise = autoSearchSubjects()

    setTimeout(() => {
      const btn = document.createElement('button')
      btn.textContent = 'Targy keresese'
      btn.addEventListener('click', clickSpy)
      document.body.appendChild(btn)
    }, 12_000)

    await vi.advanceTimersByTimeAsync(13_000)
    await promise

    expect(clickSpy).toHaveBeenCalledOnce()
    expect(api.logger.warn).not.toHaveBeenCalled()
  })

  it('clicks an English search button too', async () => {
    const clickSpy = vi.fn()
    const promise = autoSearchSubjects()

    setTimeout(() => {
      const btn = document.createElement('button')
      btn.textContent = 'Search subject'
      btn.addEventListener('click', clickSpy)
      document.body.appendChild(btn)
    }, 1_000)

    await vi.advanceTimersByTimeAsync(2_000)
    await promise

    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('logs a DOM snapshot when the search button never appears', async () => {
    const otherBtn = document.createElement('button')
    otherBtn.textContent = 'Mentes'
    document.body.appendChild(otherBtn)

    const promise = autoSearchSubjects()
    await vi.advanceTimersByTimeAsync(20_500)
    await promise

    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('search button not found within 20000ms'),
      expect.objectContaining({
        snapshot: expect.objectContaining({
          sampleButtons: ['Mentes'],
        }),
      }),
    )
  })

  it('waits for subject panels that render after the search request completes', async () => {
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        private callback: PerformanceObserverCallback
        constructor(callback: PerformanceObserverCallback) {
          this.callback = callback
          setTimeout(() => {
            this.callback(
              {
                getEntries: () => [
                  {
                    name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SchedulableSubjects',
                    responseStatus: 200,
                    startTime: 50,
                  },
                ],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 100)
        }
        observe() {}
        disconnect() {}
      },
    )

    const btn = document.createElement('button')
    btn.textContent = 'Targy keresese'
    document.body.appendChild(btn)

    const promise = waitForSubjectListing({ timeoutMs: 5_000, searchStartedAtMs: 0 })
    setTimeout(() => {
      const panel = document.createElement('mat-expansion-panel')
      document.body.appendChild(panel)
    }, 300)

    await vi.advanceTimersByTimeAsync(600)
    await expect(promise).resolves.toEqual({
      state: 'panels-loaded',
      panels: 1,
      requestStatus: 200,
    })
  })

  it('reports when the search request settles without rendering subject panels', async () => {
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        private callback: PerformanceObserverCallback
        constructor(callback: PerformanceObserverCallback) {
          this.callback = callback
          setTimeout(() => {
            this.callback(
              {
                getEntries: () => [
                  {
                    name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SchedulableSubjects',
                    responseStatus: 200,
                    startTime: 50,
                  },
                ],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 100)
        }
        observe() {}
        disconnect() {}
      },
    )

    const btn = document.createElement('button')
    btn.textContent = 'Targy keresese'
    document.body.appendChild(btn)

    const promise = waitForSubjectListing({ timeoutMs: 5_000, searchStartedAtMs: 0 })
    await vi.advanceTimersByTimeAsync(3_500)

    await expect(promise).resolves.toEqual({
      state: 'request-completed-no-panels',
      panels: 0,
      requestStatus: 200,
    })
  })

  it('can auto-click a search button that appears only during the second-stage wait', async () => {
    const clickSpy = vi.fn()

    vi.stubGlobal(
      'PerformanceObserver',
      class {
        private callback: PerformanceObserverCallback
        constructor(callback: PerformanceObserverCallback) {
          this.callback = callback
          setTimeout(() => {
            this.callback(
              {
                getEntries: () => [
                  {
                    name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SchedulableSubjects',
                    responseStatus: 200,
                    startTime: 35_000,
                  },
                ],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 35_100)
        }
        observe() {}
        disconnect() {}
      },
    )

    const promise = waitForSubjectListing({
      timeoutMs: 60_000,
      searchStartedAtMs: 20_000,
      allowAutoClick: true,
    })

    setTimeout(() => {
      const btn = document.createElement('button')
      btn.textContent = 'Search subject'
      btn.addEventListener('click', clickSpy)
      document.body.appendChild(btn)
    }, 12_000)

    setTimeout(() => {
      const panel = document.createElement('mat-expansion-panel')
      document.body.appendChild(panel)
    }, 35_500)

    await vi.advanceTimersByTimeAsync(36_000)

    expect(clickSpy).toHaveBeenCalledOnce()
    await expect(promise).resolves.toEqual({
      state: 'panels-loaded',
      panels: 1,
      requestStatus: 200,
    })
  })
})
