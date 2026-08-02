// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { getPlannerListRoot, getPlannerSubjectPanels } from '../../src/modules/course-store/planner'

/**
 * Neptun renders the timetable planner's subject list and the main registration
 * list with the same `neptun-subject-list-item` component. Observed on a live
 * Neptun instance: with the planner closed, a document-scoped lookup matched all
 * 50 subjects of the paginated registration list while the planner itself held
 * only 2. Enrolling from that list is exactly what the planner workflow exists
 * to avoid, so the scoping is pinned here.
 */
describe('planner subject scoping', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function renderMainRegistrationList(count: number): string {
    return Array.from({ length: count })
      .map(
        (_, index) => `
          <div id="subject-registration-subject-list-${index}">
            <neptun-subject-list-item>
              <mat-expansion-panel>
                <mat-expansion-panel-header>Main BME0000000${index}</mat-expansion-panel-header>
              </mat-expansion-panel>
            </neptun-subject-list-item>
          </div>`,
      )
      .join('')
  }

  it('never matches the main registration list when the planner is closed', () => {
    document.body.innerHTML = `
      ${renderMainRegistrationList(50)}
      <button class="timetable-planner__toggle-button" aria-label="Órarendtervező megnyitása">
        Órarendtervező
      </button>
      <neptun-timetable-planner></neptun-timetable-planner>
    `

    expect(document.querySelectorAll('neptun-subject-list-item mat-expansion-panel')).toHaveLength(
      50,
    )
    expect(getPlannerListRoot()).toBeNull()
    expect(getPlannerSubjectPanels(document)).toHaveLength(0)
  })

  it('matches only planner panels when both lists are rendered', () => {
    document.body.innerHTML = `
      ${renderMainRegistrationList(50)}
      <neptun-timetable-planner>
        <neptun-timetable-planner-list-view>
          <div id="signed-and-scheduled-subjects-subject-list-0">
            <neptun-subject-list-item>
              <mat-expansion-panel>
                <mat-expansion-panel-header>Planned ABC12DE345</mat-expansion-panel-header>
              </mat-expansion-panel>
            </neptun-subject-list-item>
          </div>
          <div id="signed-and-scheduled-subjects-subject-list-1">
            <neptun-subject-list-item>
              <mat-expansion-panel>
                <mat-expansion-panel-header>Planned XYZ98FG765</mat-expansion-panel-header>
              </mat-expansion-panel>
            </neptun-subject-list-item>
          </div>
        </neptun-timetable-planner-list-view>
      </neptun-timetable-planner>
    `

    const root = getPlannerListRoot()
    expect(root).not.toBeNull()
    expect(getPlannerSubjectPanels(root as Element)).toHaveLength(2)
    // Even an accidental document-wide call stays inside the planner.
    expect(getPlannerSubjectPanels(document)).toHaveLength(2)
  })
})
