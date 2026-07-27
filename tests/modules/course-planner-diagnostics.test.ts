// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlannerDiagnostics } from '../../src/modules/course-store/planner-diagnostics'
import { collectPlannerSnapshot } from '../../src/modules/course-store/planner'

describe('planner diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  // Logged as one pre-formatted string: Tampermonkey's sandboxed console renders
  // object arguments as a collapsed "Object" that cannot be read or copied.
  it('always writes a single readable line carrying the run id', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const diagnostics = createPlannerDiagnostics('preview')

    diagnostics.log('subject-list:ready', {
      panelCount: 2,
      readableCount: 2,
    })

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const [line, ...extraArgs] = consoleSpy.mock.calls[0]
    expect(extraArgs).toHaveLength(0)
    expect(typeof line).toBe('string')
    expect(line).toContain('[NPU:planner]')
    expect(line).toContain(diagnostics.runId)
    expect(line).toContain('preview')
    expect(line).toContain('subject-list:ready')
    expect(line).toContain('panelCount=2')
    expect(line).toContain('readableCount=2')
    expect(line).toMatch(/\+\d+ms/)
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
    const logLines = consoleSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('[NPU:planner]'))

    expect(logLines.length).toBeGreaterThan(3)
    expect(logLines.every((line) => line.includes(snapshot.diagnosticRunId))).toBe(true)
    expect(logLines.join('\n')).not.toContain('ABC12DE345')
    expect(logLines.join('\n')).not.toContain('NE1')
  })
})
