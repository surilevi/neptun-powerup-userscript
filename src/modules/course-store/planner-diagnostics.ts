export type PlannerDiagnosticOperation = 'prepare' | 'preview' | 'enroll'

export type PlannerDiagnosticDetails = Record<string, boolean | number | string | null>

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

/**
 * Always-on operational diagnostics for the fragile Neptun planner workflow.
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
        console.info('[NPU:planner]', {
          runId,
          operation,
          event,
          elapsedMs: Math.round(monotonicNow() - startedAt),
          ...details,
        })
      } catch {
        // Diagnostics must never interfere with the planner workflow.
      }
    },
  }
}
