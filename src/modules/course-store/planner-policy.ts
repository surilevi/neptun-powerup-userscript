/**
 * One timing policy for the complete planner workflow.
 *
 * Interactive actions may wait less because the user can retry immediately.
 * Course Rush deliberately gets a larger readiness budget for slow login-time
 * Angular rendering. Polling remains frequent enough to react quickly without
 * relying on fixed sleeps.
 *
 * Every wait in the planner workflow must come from here. Registration rushes
 * are exactly when a stray hardcoded delay becomes a lost course.
 */
export const PLANNER_TIMING = Object.freeze({
  interactiveReadinessTimeoutMs: 30_000,
  rushReadinessTimeoutMs: 60_000,
  enrollmentRequestTimeoutMs: 30_000,
  enrollmentUiUpdateTimeoutMs: 5_000,
  listStabilityWindowMs: 500,
  domPollIntervalMs: 50,
  outcomePollIntervalMs: 100,

  /**
   * Minimum gap between two clicks on the same planner control.
   *
   * Neptun opens the planner by itself during page load. Without a cooldown NPU
   * races that, and the second toggle closes what the first one opened.
   */
  controlActionCooldownMs: 1_200,
  /** How long a planner control click is given to visibly take effect. */
  controlActionSettleMs: 3_000,
  /** Bounded retries for a planner control that did not change state. */
  controlActionMaxAttempts: 3,

  /** Panel body render budget after a header click. */
  panelExpandTimeoutMs: 5_000,
  /** Last-resort settle when a panel body never matched the expected selector. */
  panelExpandFallbackMs: 800,
  /** Checkbox/DOM state settle after a click. */
  domStateSettleMs: 150,

  /**
   * Retries for a single subject when the server answers ambiguously.
   * Under rush load Neptun returns 429/5xx or simply never answers; those are
   * worth one more try, a definitive rejection is not.
   */
  enrollmentMaxAttempts: 3,
  enrollmentRetryBaseDelayMs: 700,
  /** How long Neptun's explanatory notification is given to render after a failure. */
  notificationSettleMs: 1_500,

  apiRequestTimeoutMs: 8_000,
  apiMaxAttempts: 3,
  apiRetryBaseDelayMs: 400,
  /** Grace period before re-reading enrollment state from the API after a click. */
  apiConfirmationDelayMs: 600,
})
