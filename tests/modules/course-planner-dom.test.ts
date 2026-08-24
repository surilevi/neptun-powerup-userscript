// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closePlannerIfOpenedByNpu,
  collectPlannerSnapshot,
  findPlannerSubjectPanel,
  getPlannerSubjectPanels,
  preparePlannerListView,
  readPlannerSubjectTarget,
} from '../../src/modules/course-store/planner'

describe('Neptun timetable planner DOM adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('uses an existing list view without clicking page controls', async () => {
    const clickSpy = vi.fn()
    document.body.innerHTML = `
      <button class="timetable-planner__toggle-button" aria-label="Close timetable planner">
        Timetable planner
      </button>
      <neptun-timetable-planner>
        <neptun-timetable-planner-list-view>
          <neptun-subject-list-item>
            <mat-expansion-panel>
              <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
            </mat-expansion-panel>
          </neptun-subject-list-item>
        </neptun-timetable-planner-list-view>
      </neptun-timetable-planner>
    `
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', clickSpy)
    })

    const preparation = await preparePlannerListView()

    expect(preparation).toMatchObject({
      openedPlanner: false,
      switchedToList: false,
      error: null,
    })
    expect(preparation.root?.tagName).toBe('NEPTUN-TIMETABLE-PLANNER-LIST-VIEW')
    const root = preparation.root as Element
    expect(getPlannerSubjectPanels(root)).toHaveLength(1)
    expect(findPlannerSubjectPanel('ABC12DE345', root)).not.toBeNull()
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('opens a closed planner and switches it to list view through view-only controls', async () => {
    document.body.innerHTML = `
      <button class="timetable-planner__toggle-button" aria-label="Open timetable planner">
        Timetable planner
      </button>
      <neptun-timetable-planner></neptun-timetable-planner>
    `
    const planner = document.querySelector('neptun-timetable-planner')
    const toggle = document.querySelector<HTMLButtonElement>('.timetable-planner__toggle-button')
    const toggleClickSpy = vi.fn()
    const viewClickSpy = vi.fn()
    const optionClickSpy = vi.fn()

    toggle?.addEventListener('click', () => {
      toggleClickSpy()
      toggle.setAttribute('aria-label', 'Close timetable planner')
      const view = document.createElement('div')
      view.id = 'timetable-planner-view-typeSelect'
      view.textContent = 'Weekly view'
      view.addEventListener('click', () => {
        viewClickSpy()
        const option = document.createElement('div')
        option.setAttribute('role', 'option')
        option.textContent = 'List view'
        option.addEventListener('click', () => {
          optionClickSpy()
          const list = document.createElement('neptun-timetable-planner-list-view')
          planner?.appendChild(list)
        })
        document.body.appendChild(option)
      })
      planner?.appendChild(view)
    })

    const preparation = await preparePlannerListView()

    expect(preparation).toMatchObject({
      openedPlanner: true,
      switchedToList: true,
      error: null,
    })
    expect(toggleClickSpy).toHaveBeenCalledOnce()
    expect(viewClickSpy).toHaveBeenCalledOnce()
    expect(optionClickSpy).toHaveBeenCalledOnce()
    expect(preparation.root).not.toBeNull()

    expect(closePlannerIfOpenedByNpu(preparation)).toBe(true)
    expect(toggleClickSpy).toHaveBeenCalledTimes(2)
  })

  it('refuses to click a planner toggle whose action cannot be identified', async () => {
    document.body.innerHTML = `
      <button class="timetable-planner__toggle-button">Schedule</button>
    `
    const clickSpy = vi.fn()
    document.querySelector('button')?.addEventListener('click', clickSpy)

    const preparation = await preparePlannerListView({ entryPointTimeoutMs: 20 })

    expect(preparation.root).toBeNull()
    expect(preparation.error).toContain('could not be identified safely')
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('waits for a planner toggle that arrives after the registration shell', async () => {
    const toggleClickSpy = vi.fn()
    window.setTimeout(() => {
      const toggle = document.createElement('button')
      toggle.textContent = 'Órarendtervező'
      toggle.addEventListener('click', () => {
        toggleClickSpy()
        const list = document.createElement('neptun-timetable-planner-list-view')
        document.body.appendChild(list)
      })
      document.body.appendChild(toggle)
    }, 75)

    const preparation = await preparePlannerListView({ entryPointTimeoutMs: 1_000 })

    expect(preparation).toMatchObject({
      openedPlanner: true,
      switchedToList: false,
      error: null,
    })
    expect(toggleClickSpy).toHaveBeenCalledOnce()
    expect(preparation.root?.tagName).toBe('NEPTUN-TIMETABLE-PLANNER-LIST-VIEW')
  })

  it('keeps waiting when Neptun takes longer than five seconds to open the planner', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <button class="timetable-planner__toggle-button" aria-label="Open timetable planner">
        Timetable planner
      </button>
    `
    const toggle = document.querySelector<HTMLButtonElement>('.timetable-planner__toggle-button')
    toggle?.addEventListener('click', () => {
      window.setTimeout(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<neptun-timetable-planner-list-view></neptun-timetable-planner-list-view>',
        )
      }, 6_000)
    })

    const preparationPromise = preparePlannerListView({
      entryPointTimeoutMs: 10_000,
    })
    await vi.advanceTimersByTimeAsync(7_000)
    const preparation = await preparationPromise

    expect(preparation).toMatchObject({
      openedPlanner: true,
      switchedToList: false,
      error: null,
    })
    expect(preparation.root?.tagName).toBe('NEPTUN-TIMETABLE-PLANNER-LIST-VIEW')
  })

  it('waits for planner subject panels and course rows to finish rendering', async () => {
    document.body.innerHTML = `
      <neptun-timetable-planner>
        <neptun-timetable-planner-list-view></neptun-timetable-planner-list-view>
      </neptun-timetable-planner>
    `
    const list = document.querySelector('neptun-timetable-planner-list-view')

    window.setTimeout(() => {
      list?.insertAdjacentHTML(
        'beforeend',
        `
          <neptun-subject-list-item>
            <mat-expansion-panel class="mat-expanded">
              <mat-expansion-panel-header>Delayed subject BMEVIAUAC00</mat-expansion-panel-header>
              <button>Enroll subject</button>
            </mat-expansion-panel>
          </neptun-subject-list-item>
        `,
      )
    }, 75)
    window.setTimeout(() => {
      document.querySelector('mat-expansion-panel')?.insertAdjacentHTML(
        'beforeend',
        `
          <div class="course-list-item-container course-list-item-container--selected">
            <mat-checkbox>
              <label><input type="checkbox" checked><span class="mdc-label">A1</span></label>
            </mat-checkbox>
          </div>
        `,
      )
    }, 750)

    const snapshot = await collectPlannerSnapshot({
      entryPointTimeoutMs: 100,
      contentTimeoutMs: 1_500,
    })

    expect(snapshot.contentReady).toBe(true)
    expect(snapshot.subjects).toHaveLength(1)
    expect(snapshot.subjects[0]).toMatchObject({
      subjectCode: 'BMEVIAUAC00',
      courseCodes: ['A1'],
      available: true,
    })
  })

  /**
   * Observed live on 2026-08-24 (Neptun 2026.2.9): a cold Preview Planner run
   * reported 5/6 subjects ready while an immediate warm re-run reported 6/6 on
   * the exact same planner. Rows render before Neptun marks which of them the
   * planner holds, so waiting for rows alone snapshots an empty selection and
   * silently drops that subject. Course Rush runs once and disables itself, so
   * there is no warm second run to save it during a registration rush.
   */
  it('waits for planner selection state to settle after the course rows render', async () => {
    document.body.innerHTML = `
      <neptun-timetable-planner>
        <neptun-timetable-planner-list-view>
          <neptun-subject-list-item>
            <mat-expansion-panel class="mat-expanded">
              <mat-expansion-panel-header>Late selection BMEVIAUAC00</mat-expansion-panel-header>
              <button>Enroll subject</button>
              <div class="course-list-item-container">
                <div class="code-with-time"><h6 class="h6-unformatted">A1</h6></div>
                <input type="checkbox">
              </div>
            </mat-expansion-panel>
          </neptun-subject-list-item>
        </neptun-timetable-planner-list-view>
      </neptun-timetable-planner>
    `

    // The row is present from the first poll; only its selection arrives late,
    // well after the point where waiting on rows alone would have read the panel.
    window.setTimeout(() => {
      const row = document.querySelector('.course-list-item-container')
      row?.classList.add('course-list-item-container--selected')
      row?.querySelector('input')?.setAttribute('checked', '')
    }, 1_500)

    const snapshot = await collectPlannerSnapshot({
      entryPointTimeoutMs: 100,
      contentTimeoutMs: 6_000,
    })

    expect(snapshot.contentReady).toBe(true)
    expect(snapshot.subjects).toHaveLength(1)
    expect(snapshot.subjects[0]).toMatchObject({
      subjectCode: 'BMEVIAUAC00',
      courseCodes: ['A1'],
      available: true,
    })
    expect(snapshot.issues).toEqual([])
  })

  it('does not report an empty planner while its list content is still unresolved', async () => {
    document.body.innerHTML = `
      <neptun-timetable-planner-list-view></neptun-timetable-planner-list-view>
    `

    const snapshot = await collectPlannerSnapshot({
      entryPointTimeoutMs: 20,
      contentTimeoutMs: 100,
    })

    expect(snapshot.contentReady).toBe(false)
    expect(snapshot.listedSubjects).toBe(0)
    expect(snapshot.issues).toContain('Neptun timetable planner subjects did not finish loading')
  })

  it('reads a far-back planned course without touching the paginated main list', async () => {
    const mainPanels = Array.from(
      { length: 50 },
      (_, index) =>
        `<mat-expansion-panel><mat-expansion-panel-header>Main subject ${index} ABC12DE${String(index).padStart(3, '0')}</mat-expansion-panel-header></mat-expansion-panel>`,
    ).join('')
    document.body.innerHTML = `
      <section class="main-subject-list">${mainPanels}</section>
      <button class="load-more">Továbbiak betöltése</button>
      <neptun-timetable-planner>
        <neptun-timetable-planner-list-view>
          <neptun-subject-list-item>
            <mat-expansion-panel class="mat-expanded">
              <mat-expansion-panel-header>Far planned subject BMEVIAUAC00</mat-expansion-panel-header>
              <div class="course-list-item-container course-list-item-container--selected">
                <mat-checkbox>
                  <label><input type="checkbox" checked><span class="mdc-label">A1</span></label>
                </mat-checkbox>
              </div>
              <button>Tárgy felvétele</button>
            </mat-expansion-panel>
          </neptun-subject-list-item>
        </neptun-timetable-planner-list-view>
      </neptun-timetable-planner>
    `
    const loadMoreClickSpy = vi.fn()
    const checkboxClickSpy = vi.fn()
    document.querySelector('.load-more')?.addEventListener('click', loadMoreClickSpy)
    document.querySelector('input[type="checkbox"]')?.addEventListener('click', checkboxClickSpy)

    const snapshot = await collectPlannerSnapshot()

    expect(snapshot.subjects).toHaveLength(1)
    expect(snapshot.subjects[0]).toMatchObject({
      subjectCode: 'BMEVIAUAC00',
      courseCodes: ['A1'],
      available: true,
    })
    expect(loadMoreClickSpy).not.toHaveBeenCalled()
    expect(checkboxClickSpy).not.toHaveBeenCalled()
  })

  it('requires the original panel identity when duplicate subject codes exist', () => {
    document.body.innerHTML = `
      <neptun-timetable-planner>
      <neptun-timetable-planner-list-view>
        <neptun-subject-list-item>
          <mat-expansion-panel class="mat-expanded">
            <mat-expansion-panel-header>First ABC12DE345</mat-expansion-panel-header>
            <div class="course-list-item-container course-list-item-container--selected">
              <mat-checkbox><label><span class="mdc-label">A1</span></label></mat-checkbox>
            </div>
            <button>Enroll subject</button>
          </mat-expansion-panel>
        </neptun-subject-list-item>
        <neptun-subject-list-item>
          <mat-expansion-panel class="mat-expanded">
            <mat-expansion-panel-header>Second ABC12DE345</mat-expansion-panel-header>
            <div class="course-list-item-container course-list-item-container--selected">
              <mat-checkbox><label><span class="mdc-label">B1</span></label></mat-checkbox>
            </div>
            <button>Enroll subject</button>
          </mat-expansion-panel>
        </neptun-subject-list-item>
      </neptun-timetable-planner-list-view>
      </neptun-timetable-planner>
    `
    const panels = getPlannerSubjectPanels(document)

    expect(readPlannerSubjectTarget('ABC12DE345')).toBeNull()
    expect(readPlannerSubjectTarget('ABC12DE345', panels[0])?.courseCodes).toEqual(['A1'])
    expect(readPlannerSubjectTarget('ABC12DE345', panels[1])?.courseCodes).toEqual(['B1'])
  })
})
