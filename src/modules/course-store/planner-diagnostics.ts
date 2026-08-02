export type PlannerDiagnosticOperation = 'prepare' | 'preview' | 'enroll'

export type PlannerDiagnosticDetails = Record<string, boolean | number | string | null | undefined>

export interface PlannerDiagnostics {
  readonly runId: string
  log(event: string, details?: PlannerDiagnosticDetails): void
}

let runSequence = 0

function monotonicNow(): number {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

function formatDetails(details: PlannerDiagnosticDetails): string {
  return Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`)
    .join(' ')
}

/**
 * Always-on operational diagnostics for the fragile Neptun planner workflow.
 *
 * Logged as a single pre-formatted string rather than an object: Tampermonkey
 * runs userscripts against a sandboxed `console`, so object arguments render as
 * a collapsed "Object" that neither the user nor external tooling can read.
 *
 * Callers intentionally provide only phase names, timings, states, and counts.
 * Never add tokens, account data, subject codes, course codes, or DOM text.
 */
export function createPlannerDiagnostics(
  operation: PlannerDiagnosticOperation,
): PlannerDiagnostics {
  const startedAt = monotonicNow()
  const runId = `planner-${Date.now().toString(36)}-${++runSequence}`

  return {
    runId,
    log(event: string, details: PlannerDiagnosticDetails = {}): void {
      try {
        const elapsedMs = Math.round(monotonicNow() - startedAt)
        const tail = formatDetails(details)
        console.info(
          `[NPU:planner] ${runId} ${operation} +${elapsedMs}ms ${event}${tail ? ` ${tail}` : ''}`,
        )
      } catch {
        // Diagnostics must never interfere with the planner workflow.
      }
    },
  }
}
