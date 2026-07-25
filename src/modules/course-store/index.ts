import type { NpuModule, ModuleApi, PageContext } from '../../types/modules'
import { getApi, setApi, setIsEnrolling, getRouteUnsub, setRouteUnsub } from './state'
import { loadSelections } from './storage'
import { autoSearchSubjects, getSubjectPanels, waitForSubjectListing } from './dom'
import { loadAndEnroll } from './enroll'
import { renderModuleUI } from './ui'
import { clearCoursePreview } from './preview'
import { enrollPlannedCourses } from './planner-enroll'
import { closePlannerSafely } from './planner'
import { PLANNER_TIMING } from './planner-policy'

async function runLocalSavedRushFallback(api: ModuleApi): Promise<void> {
  api.statusPanel.addMessage(
    'info',
    'Neptun timetable planner is empty. Trying locally saved courses as the fallback...',
  )
  const autoSearchResult = await autoSearchSubjects()
  let panelCount = getSubjectPanels().length

  if (panelCount === 0) {
    const listingResult = await waitForSubjectListing({
      timeoutMs: PLANNER_TIMING.rushReadinessTimeoutMs,
      searchStartedAtMs: autoSearchResult.searchStartedAtMs ?? performance.now(),
      allowAutoClick: !autoSearchResult.clickedSearchButton,
    })
    panelCount = listingResult.panels

    if (panelCount === 0) {
      if (listingResult.state === 'request-failed' && listingResult.requestStatus !== null) {
        api.logger.warn(
          `Rush Mode: subject search failed with status ${listingResult.requestStatus}`,
        )
        api.statusPanel.addMessage(
          'warn',
          `Subject search failed (${listingResult.requestStatus}). Registration may not be open yet.`,
        )
      } else if (listingResult.state === 'request-completed-no-panels') {
        api.logger.warn('Rush Mode: subject search completed but no subjects were listed')
        api.statusPanel.addMessage(
          'warn',
          'Subject search completed, but no subjects were listed. Check filters or registration availability.',
        )
      } else {
        api.logger.warn('Rush Mode: timed out waiting for subject listing - cannot auto-enroll')
        api.statusPanel.addMessage(
          'warn',
          'Timed out waiting for subjects to load. Try refreshing and enabling Rush Mode again.',
        )
      }
      return
    }
  }

  await loadAndEnroll()
}

export const courseStoreModule: NpuModule = {
  id: 'course-store',
  name: 'Course Store',
  description: 'Save course selections and restore them later',

  shouldActivate(context: PageContext): boolean {
    return context.path.includes('/subjects/registration')
  },

  async initialize(moduleApi: ModuleApi): Promise<void> {
    setApi(moduleApi)
    const api = moduleApi

    await renderModuleUI()

    const selections = await loadSelections()
    const count = Object.keys(selections).length
    if (count > 0) {
      const courseCount = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0)
      api.statusPanel.addMessage(
        'info',
        `${count} saved subject${count === 1 ? '' : 's'}, ${courseCount} course${courseCount === 1 ? '' : 's'}. Use Load to restore.`,
      )
      api.logger.info(`found ${count} stored subject selection(s)`)
    }

    setRouteUnsub(
      api.bus.on('page:changed', (payload) => {
        if (payload.path.includes('/subjects/registration')) {
          const currentApi = getApi()
          if (!currentApi) return
          renderModuleUI()
            .then(async () => {
              const freshApi = getApi()
              if (!freshApi) return
              const sel = await loadSelections()
              const storedSubjects = Object.keys(sel).length
              if (storedSubjects > 0) {
                const storedCourses = Object.values(sel).reduce((sum, arr) => sum + arr.length, 0)
                freshApi.statusPanel.addMessage(
                  'info',
                  `${storedSubjects} saved subject${storedSubjects === 1 ? '' : 's'}, ${storedCourses} course${storedCourses === 1 ? '' : 's'}. Use Load to restore.`,
                )
              }
            })
            .catch((err) => {
              const freshApi = getApi()
              const log = freshApi?.logger ?? console
              log.error('error in route change handler:', err)
            })
        }
      }),
    )

    const rushOn = api.statusPanel.getCourseRushMode()
    if (rushOn) {
      api.logger.info('Course Rush Mode active - using Neptun timetable planner first')
      api.statusPanel.setCourseRushMode(false)
      api.statusPanel.addMessage(
        'info',
        'Course Rush started and turned itself off. Waiting for Neptun timetable planner...',
      )

      const plannerResult = await enrollPlannedCourses({
        plannerWaitTimeoutMs: PLANNER_TIMING.rushReadinessTimeoutMs,
      })

      if (!plannerResult.plannerReady) {
        api.statusPanel.addMessage(
          'warn',
          'Neptun timetable planner did not become ready. Local fallback was not started automatically; nothing else was clicked.',
        )
      } else if (
        plannerResult.listedSubjects === 0 &&
        plannerResult.plannedSubjects === 0 &&
        plannerResult.attempted === 0 &&
        !plannerResult.aborted
      ) {
        const rushSelections = await loadSelections()
        if (Object.keys(rushSelections).length > 0) {
          const canReturnToSubjectList = plannerResult.openedPlanner && closePlannerSafely()

          if (canReturnToSubjectList) {
            await runLocalSavedRushFallback(api)
          } else {
            api.logger.warn(
              'Rush Mode: planner was already open and empty; local fallback was not started automatically',
            )
            api.statusPanel.addMessage(
              'warn',
              'Planner is empty, but it was already open. Close it and use Local Load + Enroll for the saved fallback.',
            )
          }
        } else {
          api.statusPanel.addMessage(
            'warn',
            'No planned subjects or locally saved fallback courses were found. Nothing was clicked.',
          )
        }
      }
    } else {
      await autoSearchSubjects()
    }

    api.logger.info('initialized on registration page')
  },

  dispose(): void {
    setIsEnrolling(false)
    clearCoursePreview()
    getRouteUnsub()?.()
    setRouteUnsub(null)
    setApi(null)
  },
}
