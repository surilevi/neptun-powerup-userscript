// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'

const mocks = vi.hoisted(() => ({
  autoSearchSubjects: vi.fn(),
  getSubjectPanels: vi.fn(),
  waitForSubjectListing: vi.fn(),
  loadSelections: vi.fn(),
  loadAndEnroll: vi.fn(),
  renderModuleUI: vi.fn(),
  clearCoursePreview: vi.fn(),
  enrollPlannedCourses: vi.fn(),
  closePlannerSafely: vi.fn(),
}))

vi.mock('../../src/modules/course-store/dom', () => ({
  autoSearchSubjects: mocks.autoSearchSubjects,
  getSubjectPanels: mocks.getSubjectPanels,
  waitForSubjectListing: mocks.waitForSubjectListing,
}))
vi.mock('../../src/modules/course-store/storage', () => ({
  loadSelections: mocks.loadSelections,
}))
vi.mock('../../src/modules/course-store/enroll', () => ({
  loadAndEnroll: mocks.loadAndEnroll,
}))
vi.mock('../../src/modules/course-store/ui', () => ({
  renderModuleUI: mocks.renderModuleUI,
}))
vi.mock('../../src/modules/course-store/preview', () => ({
  clearCoursePreview: mocks.clearCoursePreview,
}))
vi.mock('../../src/modules/course-store/planner-enroll', () => ({
  enrollPlannedCourses: mocks.enrollPlannedCourses,
}))
vi.mock('../../src/modules/course-store/planner', () => ({
  closePlannerSafely: mocks.closePlannerSafely,
}))

import { courseStoreModule } from '../../src/modules/course-store'
import { PLANNER_TIMING } from '../../src/modules/course-store/planner-policy'

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
      getCourseRushMode: vi.fn(() => true),
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

function plannerResult(
  overrides: Partial<Awaited<ReturnType<typeof mocks.enrollPlannedCourses>>> = {},
) {
  return {
    plannerReady: true,
    openedPlanner: true,
    listedSubjects: 2,
    plannedSubjects: 2,
    eligibleSubjects: 2,
    attempted: 2,
    enrolled: 2,
    failed: 0,
    skipped: 0,
    aborted: false,
    errors: [],
    ...overrides,
  }
}

describe('course-store Course Rush source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.renderModuleUI.mockResolvedValue(undefined)
    mocks.loadSelections.mockResolvedValue({ BMEVIAUAC00: ['A1'] })
    mocks.autoSearchSubjects.mockResolvedValue({
      clickedSearchButton: true,
      searchStartedAtMs: 1,
    })
    mocks.getSubjectPanels.mockReturnValue([document.createElement('div')])
    mocks.loadAndEnroll.mockResolvedValue(undefined)
    mocks.closePlannerSafely.mockReturnValue(true)
  })

  afterEach(() => {
    courseStoreModule.dispose?.()
  })

  it('uses the planner first and does not load the paginated subject list', async () => {
    const api = createMockApi()
    mocks.enrollPlannedCourses.mockResolvedValue(plannerResult())

    await courseStoreModule.initialize(api)

    expect(mocks.enrollPlannedCourses).toHaveBeenCalledWith({
      plannerWaitTimeoutMs: PLANNER_TIMING.rushReadinessTimeoutMs,
    })
    expect(api.statusPanel.setCourseRushMode).toHaveBeenCalledWith(false)
    expect(mocks.autoSearchSubjects).not.toHaveBeenCalled()
    expect(mocks.loadAndEnroll).not.toHaveBeenCalled()
  })

  it('falls back to local saves only when an NPU-opened planner is empty', async () => {
    const api = createMockApi()
    mocks.enrollPlannedCourses.mockResolvedValue(
      plannerResult({
        plannedSubjects: 0,
        listedSubjects: 0,
        eligibleSubjects: 0,
        attempted: 0,
        enrolled: 0,
        errors: ['No planned subjects are visible'],
      }),
    )

    await courseStoreModule.initialize(api)

    expect(mocks.closePlannerSafely).toHaveBeenCalledOnce()
    expect(mocks.autoSearchSubjects).toHaveBeenCalledOnce()
    expect(mocks.loadAndEnroll).toHaveBeenCalledOnce()
  })

  it('does not close a planner that the user already had open to force a fallback', async () => {
    const api = createMockApi()
    mocks.enrollPlannedCourses.mockResolvedValue(
      plannerResult({
        openedPlanner: false,
        listedSubjects: 0,
        plannedSubjects: 0,
        eligibleSubjects: 0,
        attempted: 0,
        enrolled: 0,
        errors: ['No planned subjects are visible'],
      }),
    )

    await courseStoreModule.initialize(api)

    expect(mocks.closePlannerSafely).not.toHaveBeenCalled()
    expect(mocks.autoSearchSubjects).not.toHaveBeenCalled()
    expect(mocks.loadAndEnroll).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Local Load + Enroll'),
    )
  })

  it('does not fall back when planner entries exist but cannot be read safely', async () => {
    const api = createMockApi()
    mocks.enrollPlannedCourses.mockResolvedValue(
      plannerResult({
        listedSubjects: 1,
        plannedSubjects: 0,
        eligibleSubjects: 0,
        attempted: 0,
        enrolled: 0,
        errors: ['Planner subject code could not be read'],
      }),
    )

    await courseStoreModule.initialize(api)

    expect(mocks.closePlannerSafely).not.toHaveBeenCalled()
    expect(mocks.autoSearchSubjects).not.toHaveBeenCalled()
    expect(mocks.loadAndEnroll).not.toHaveBeenCalled()
  })

  it('does not treat unavailable planner controls as an empty planner', async () => {
    const api = createMockApi()
    mocks.enrollPlannedCourses.mockResolvedValue(
      plannerResult({
        plannerReady: false,
        openedPlanner: false,
        listedSubjects: 0,
        plannedSubjects: 0,
        eligibleSubjects: 0,
        attempted: 0,
        enrolled: 0,
        errors: ['Planner controls timed out'],
      }),
    )

    await courseStoreModule.initialize(api)

    expect(mocks.closePlannerSafely).not.toHaveBeenCalled()
    expect(mocks.autoSearchSubjects).not.toHaveBeenCalled()
    expect(mocks.loadAndEnroll).not.toHaveBeenCalled()
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('did not become ready'),
    )
  })
})
