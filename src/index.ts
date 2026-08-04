import { createEventBus } from './core/event-bus'
import { createLogger } from './core/logger'
import { createModuleRegistry } from './core/module-registry'
import { createStatusPanel } from './core/status-panel'
import { createStorageService, type GmStorage } from './core/storage'
import { setupInterceptor } from './core/interceptor'
import { extractDomain } from './utils/domain'
import { isLikelyNeptunPortal } from './utils/neptun-detect'
import { extractPath, observeRouteChanges } from './utils/page'
import type { PageContext } from './types/modules'
import { infiniteSessionModule } from './modules/infinite-session'
import { courseStoreModule } from './modules/course-store'
import { examSignupModule } from './modules/exam-signup'
import { pinkModeModule } from './modules/pink-mode'
import { versionWatchModule } from './modules/version-watch'
import type { ThemeSettings } from './modules/pink-mode'
import { DEFAULT_THEME } from './modules/pink-mode'
import { hasConsent, storeConsent, resetConsent, showConsentDialog } from './core/consent'
import {
  clearRedirectBudget,
  decideRushRedirect,
  hasAccessToken,
  isOnRushPage,
  performRushRedirect,
  type RushKind,
} from './core/rush-navigation'
import {
  countSavedChoices,
  createSavedChoicesBackup,
  parseSavedChoicesBackup,
  restoreSavedChoicesBackup,
} from './core/saved-choices'
import {
  chooseSavedChoicesBackupFile,
  downloadSavedChoicesBackup,
  readSavedChoicesBackupFile,
} from './core/saved-choices-file'

function describeSavedChoices(
  verb: 'Exported' | 'Imported',
  counts: { subjects: number; courses: number; exams: number },
): string {
  return `${verb} ${counts.subjects} saved subject${counts.subjects === 1 ? '' : 's'}, ${counts.courses} course${counts.courses === 1 ? '' : 's'}, and ${counts.exams} exam${counts.exams === 1 ? '' : 's'}.`
}

async function main(): Promise<void> {
  const logger = createLogger('core')
  if (!isLikelyNeptunPortal()) {
    return
  }

  logger.info('Neptun PowerUp! v3 starting...')

  // Resolve GM storage (provided by Tampermonkey at runtime). Do not fall back
  // to page localStorage: that storage is visible to same-origin page scripts.
  if (
    typeof GM === 'undefined' ||
    typeof GM.getValue !== 'function' ||
    typeof GM.setValue !== 'function'
  ) {
    logger.error('Tampermonkey GM storage API is unavailable; NPU will not activate.')
    return
  }

  const gmStorage: GmStorage = {
    getValue: (key, defaultVal) => GM.getValue(key, defaultVal),
    setValue: (key, value) => GM.setValue(key, value),
  }

  // Build initial page context
  const domain = extractDomain(window.location.href)

  function buildContext(): PageContext {
    return {
      url: window.location.href,
      domain,
      path: extractPath(window.location.href),
    }
  }

  logger.info(`domain: ${domain}, path: ${buildContext().path}`)

  // Initialize core systems
  const bus = createEventBus()

  // Set up rush mode persistence via a global storage service (not domain-scoped)
  const rushStorage = createStorageService(gmStorage, domain)

  // --- Consent gate ---
  // Check if user has accepted the consent dialog for this domain.
  // If not, show it and wait. If declined, exit — no NPU features activate.
  const consentAccepted = await hasConsent(rushStorage)
  if (!consentAccepted) {
    const version =
      typeof GM !== 'undefined' && GM.info?.script?.version ? GM.info.script.version : 'dev'
    const accepted = await showConsentDialog(version)
    if (accepted) {
      await storeConsent(rushStorage)
      logger.info('consent accepted')
    } else {
      logger.info('consent declined — NPU will not activate')
      return
    }
  }

  // Read initial rush mode state before creating the panel
  const courseRushInitial = (await rushStorage.get<boolean>('courseRushMode')) ?? false
  const examRushInitial = (await rushStorage.get<boolean>('examRushMode')) ?? false

  // --- Theme settings migration & loading ---
  // Migrate old pinkMode boolean to new themeSettings format
  const oldPinkMode = await rushStorage.get<boolean>('pinkMode')
  if (oldPinkMode === true) {
    const migrated: ThemeSettings = { enabled: true, color: 'pink' }
    await rushStorage.setForDomain('themeSettings', migrated)
    await rushStorage.remove('pinkMode')
    logger.info('migrated pinkMode=true to themeSettings')
  }

  const savedThemeSettings = await rushStorage.getForDomain<ThemeSettings>('themeSettings')
  const themeInitial: ThemeSettings = savedThemeSettings ?? { ...DEFAULT_THEME }

  logger.info(`rush mode initial state — course: ${courseRushInitial}, exam: ${examRushInitial}`)

  // Create unified status panel with rush mode wiring
  const statusPanel = createStatusPanel(
    bus,
    {
      onCourseRushChange: async (on) => {
        try {
          await rushStorage.set('courseRushMode', on)
        } catch (err) {
          logger.error('failed to persist courseRushMode:', err)
        }
        logger.info(`Course Rush Mode ${on ? 'ON' : 'OFF'}`)
        statusPanel.addMessage('info', `Course Rush ${on ? 'on' : 'off'}`)
      },
      onExamRushChange: async (on) => {
        try {
          await rushStorage.set('examRushMode', on)
        } catch (err) {
          logger.error('failed to persist examRushMode:', err)
        }
        logger.info(`Exam Rush Mode ${on ? 'ON' : 'OFF'}`)
        statusPanel.addMessage('info', `Exam Rush ${on ? 'on' : 'off'}`)
      },
      onConsentReset: () => {
        resetConsent(rushStorage).catch((err) => logger.error('failed to reset consent:', err))
        logger.info('Consent reset — dialog will appear on next load')
        statusPanel.addMessage('info', 'Consent prompt will appear on the next page load.')
      },
      onThemeChange: (settings) => {
        rushStorage
          .setForDomain('themeSettings', settings)
          .catch((err) => logger.error('failed to persist themeSettings:', err))
        logger.info(`Theme ${settings.enabled ? `enabled (${settings.color})` : 'disabled'}`)
      },
      onExportSavedChoices: async () => {
        try {
          const backup = await createSavedChoicesBackup(rushStorage)
          downloadSavedChoicesBackup(backup)
          const message = describeSavedChoices('Exported', countSavedChoices(backup))
          logger.info(message)
          return message
        } catch (err) {
          logger.error('failed to export saved choices:', err)
          throw err
        }
      },
      onImportSavedChoices: async () => {
        try {
          const file = await chooseSavedChoicesBackupFile()
          if (!file) return null

          const backup = parseSavedChoicesBackup(await readSavedChoicesBackupFile(file))
          const counts = countSavedChoices(backup)
          const confirmed = window.confirm(
            `Import ${counts.subjects} saved subject${counts.subjects === 1 ? '' : 's'}, ${counts.courses} course${counts.courses === 1 ? '' : 's'}, and ${counts.exams} exam${counts.exams === 1 ? '' : 's'}? This replaces the current saved course and exam choices for this Neptun domain.`,
          )
          if (!confirmed) return null

          await restoreSavedChoicesBackup(rushStorage, backup)
          const message = describeSavedChoices('Imported', counts)
          logger.info(message)
          statusPanel.addMessage('info', message)
          bus.emit('saved-choices:restored', {})
          return message
        } catch (err) {
          logger.error('failed to import saved choices:', err)
          throw err
        }
      },
    },
    {
      courseRush: courseRushInitial,
      examRush: examRushInitial,
    },
    themeInitial,
  )

  // Start monitoring sessionStorage for token changes
  const stopInterceptor = setupInterceptor(bus, createLogger('interceptor'))

  // Register modules
  const registry = createModuleRegistry(bus, gmStorage, statusPanel)
  registry.register(versionWatchModule)
  registry.register(infiniteSessionModule)
  registry.register(courseStoreModule)
  registry.register(examSignupModule)
  registry.register(pinkModeModule)

  // Activate modules for current page
  await registry.activateAll(buildContext())

  /**
   * Send an armed rush to its page.
   *
   * Evaluated from current page state rather than from a route transition, so it
   * also covers the case the SPA handler below cannot see: a credential login
   * that ends in a full page load, which is what happens on a real rush day.
   */
  function tryRushRedirect(kind: RushKind, reason: string): boolean {
    const path = extractPath(window.location.href)
    const decision = decideRushRedirect(kind, path, hasAccessToken())

    if (decision.action === 'already-there') {
      clearRedirectBudget()
      return false
    }

    if (decision.action === 'budget-exhausted') {
      logger.warn(`${kind} rush: redirect budget exhausted, staying on ${path}`)
      statusPanel.addMessage(
        'warn',
        `Could not reach the ${kind === 'course' ? 'course registration' : 'exam'} page automatically. Open it manually and re-enable the rush.`,
      )
      return false
    }

    if (decision.action === 'wait-for-login') return false

    logger.info(`${kind} rush: navigating to rush page (${reason})`)
    statusPanel.addMessage(
      'info',
      `Opening ${kind === 'course' ? 'course registration' : 'exam overview'} for ${kind === 'course' ? 'Course' : 'Exam'} Rush...`,
    )
    registry.disposeAll()
    performRushRedirect(decision.url)
    return true
  }

  function armedRushKind(): RushKind | null {
    if (statusPanel.getCourseRushMode()) return 'course'
    if (statusPanel.getExamRushMode()) return 'exam'
    return null
  }

  const initialRush = armedRushKind()
  if (initialRush) {
    if (isOnRushPage(initialRush, extractPath(window.location.href))) {
      clearRedirectBudget()
    } else if (!tryRushRedirect(initialRush, 'page load')) {
      // Not authenticated yet — the login may complete without a route change,
      // so react to the token appearing instead of to navigation.
      const stopWaiting = bus.on('token:acquired', () => {
        const kind = armedRushKind()
        if (!kind) {
          stopWaiting()
          return
        }
        if (tryRushRedirect(kind, 'token acquired')) stopWaiting()
      })
    }
  } else {
    clearRedirectBudget()
  }

  // Observe SPA route changes and re-evaluate modules on navigation
  observeRouteChanges(bus)
  bus.on('page:changed', async () => {
    logger.info(`route changed: ${window.location.pathname}`)

    // --- Rush mode redirect ---
    // Any navigation is a chance to get an armed rush onto its own page; the
    // decision is made from current state, so it does not depend on having
    // observed the login transition itself.
    const rushKind = armedRushKind()
    if (rushKind && tryRushRedirect(rushKind, 'route change')) return

    // Dispose modules that shouldn't run on the new page before re-activating
    registry.disposeAll()
    await registry.activateAll(buildContext())
  })

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    try {
      stopInterceptor()
      registry.disposeAll()
      statusPanel.dispose()
    } catch (err) {
      logger.error('error during beforeunload cleanup:', err)
    }
  })

  logger.info('startup complete')
}

main().catch((error) => {
  console.error('[NPU:core] fatal startup error:', error)
})
