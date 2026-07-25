// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlannerDiagnostics } from '../../src/modules/course-store/planner-diagnostics'
import { collectPlannerSnapshot } from '../../src/modules/course-store/planner'

describe('planner diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('always writes a structured, copyable event with a stable run id', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const diagnostics = createPlannerDiagnostics('preview')

    diagnostics.log('subject-list:ready', {
      panelCount: 2,
      readableCount: 2,
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      '[NPU:planner]',
      expect.objectContaining({
        runId: diagnostics.runId,
        operation: 'preview',
        event: 'subject-list:ready',
        elapsedMs: expect.any(Number),
        panelCount: 2,
        readableCount: 2,
      }),
    )
  })

  it('uses a new run id for each planner operation', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const preview = createPlannerDiagnostics('preview')
    const enroll = createPlannerDiagnostics('enroll')

    expect(preview.runId).not.toBe(enroll.runId)
  })

  it('uses one run id across planner phases without logging course identifiers', async () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    document.body.innerHTML = `
      <neptun-timetable-planner-list-view>
        <neptun-subject-list-item>
          <mat-expansion-panel class="mat-expanded">
            <mat-expansion-panel-header>Algorithms ABC12DE345</mat-expansion-panel-header>
            <div class="course-list-item-container course-list-item-container--selected">
              <mat-checkbox><label><span class="mdc-label">NE1</span></label></mat-checkbox>
            </div>
            <button>Enroll subject</button>
          </mat-expansion-panel>
        </neptun-subject-list-item>
      </neptun-timetable-planner-list-view>
    `

    const snapshot = await collectPlannerSnapshot({
      entryPointTimeoutMs: 100,
      contentTimeoutMs: 1_000,
    })
    const logEntries = consoleSpy.mock.calls.map((call) => call[1])

    expect(logEntries.length).toBeGreaterThan(3)
    expect(new Set(logEntries.map((entry) => (entry as { runId: string }).runId))).toEqual(
      new Set([snapshot.diagnosticRunId]),
    )
    expect(JSON.stringify(logEntries)).not.toContain('ABC12DE345')
    expect(JSON.stringify(logEntries)).not.toContain('NE1')
  })
})
