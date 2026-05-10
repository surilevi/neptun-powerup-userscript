import type { NpuModule, ModuleApi, PageContext } from '../../types/modules'
import { getApi, setApi, setIsEnrolling, getRouteUnsub, setRouteUnsub } from './state'
import { loadSelections } from './storage'
import { autoSearchSubjects, getSubjectPanels, waitForSubjectListing } from './dom'
import { loadAndEnroll } from './enroll'
import { renderModuleUI } from './ui'

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

    const autoSearchResult = await autoSearchSubjects()

    const rushOn = api.statusPanel.getCourseRushMode()
    if (rushOn) {
      const rushSelections = await loadSelections()
      if (Object.keys(rushSelections).length > 0) {
        api.logger.info('Course Rush Mode active - auto-triggering Load & Enroll')
        api.statusPanel.addMessage('info', 'Course Rush is enrolling saved courses...')
        api.statusPanel.setCourseRushMode(false)
        api.statusPanel.addMessage('info', 'Course Rush started and turned itself off.')

        let panelCount = getSubjectPanels().length

        if (panelCount === 0) {
          const listingResult = await waitForSubjectListing({
            timeoutMs: 60_000,
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
              api.logger.warn(
                'Rush Mode: timed out waiting for subject listing - cannot auto-enroll',
              )
              api.statusPanel.addMessage(
                'warn',
                'Timed out waiting for subjects to load. Try refreshing and enabling Rush Mode again.',
              )
            }
            return
          }
        }

        if (panelCount === 0) {
          api.logger.warn('Rush Mode: no subjects are listed - cannot auto-enroll')
          api.statusPanel.addMessage(
            'warn',
            'No subjects loaded. Try refreshing and enabling Rush Mode again.',
          )
          return
        }

        loadAndEnroll().catch((err) => api.logger.error('rush auto-enroll failed:', err))
      }
    }

    api.logger.info('initialized on registration page')
  },

  dispose(): void {
    setIsEnrolling(false)
    getRouteUnsub()?.()
    setRouteUnsub(null)
    setApi(null)
  },
}
