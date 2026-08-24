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

  /**
   * Course Rush asks for twice the interactive readiness budget because it runs
   * against slow login-time rendering. The empty-selection grace is the wait that
   * decides whether a not-yet-applied planner selection is believed to be empty,
   * so it has to scale with that budget instead of staying a flat number.
   */
  it('scales the empty-selection grace with the readiness budget', async () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const renderPlanner = () => {
      document.body.innerHTML = `
        <neptun-timetable-planner-list-view>
          <neptun-subject-list-item>
            <mat-expansion-panel class="mat-expanded">
              <mat-expansion-panel-header>Subject BMEVIAUAC00</mat-expansion-panel-header>
              <button>Enroll subject</button>
              <div class="course-list-item-container course-list-item-container--selected">
                <div class="code-with-time"><h6 class="h6-unformatted">A1</h6></div>
              </div>
            </mat-expansion-panel>
          </neptun-subject-list-item>
        </neptun-timetable-planner-list-view>
      `
    }

    const graceFromLastRun = (): number => {
      const line = consoleSpy.mock.calls
        .map(([entry]) => String(entry))
        .find((entry) => entry.includes('course-rows:waiting'))
      return Number(/emptySelectionGraceMs=(\d+)/.exec(line ?? '')?.[1])
    }

    renderPlanner()
    await collectPlannerSnapshot({ entryPointTimeoutMs: 100, contentTimeoutMs: 30_000 })
    const interactiveGrace = graceFromLastRun()

    consoleSpy.mockClear()
    renderPlanner()
    await collectPlannerSnapshot({ entryPointTimeoutMs: 100, contentTimeoutMs: 60_000 })
    const rushGrace = graceFromLastRun()

    expect(interactiveGrace).toBe(3_000)
    expect(rushGrace).toBe(6_000)
    expect(rushGrace).toBeGreaterThan(interactiveGrace)
  })
})
