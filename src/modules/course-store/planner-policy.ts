/**
 * One timing policy for the complete planner workflow.
 *
 * Interactive actions may wait less because the user can retry immediately.
 * Course Rush deliberately gets a larger readiness budget for slow login-time
 * Angular rendering. Polling remains frequent enough to react quickly without
 * relying on fixed sleeps.
 */
export const PLANNER_TIMING = Object.freeze({
  interactiveReadinessTimeoutMs: 30_000,
  rushReadinessTimeoutMs: 60_000,
  enrollmentRequestTimeoutMs: 30_000,
  enrollmentUiUpdateTimeoutMs: 5_000,
  listStabilityWindowMs: 500,
  domPollIntervalMs: 50,
  outcomePollIntervalMs: 100,
})
