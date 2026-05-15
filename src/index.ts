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
import type { ThemeSettings } from './modules/pink-mode'
import { DEFAULT_THEME } from './modules/pink-mode'
import { hasConsent, storeConsent, resetConsent, showConsentDialog } from './core/consent'

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
      onCourseRushChange: (on) => {
        rushStorage
          .set('courseRushMode', on)
          .catch((err) => logger.error('failed to persist courseRushMode:', err))
        logger.info(`Course Rush Mode ${on ? 'ON' : 'OFF'}`)
        statusPanel.addMessage('info', `Course Rush ${on ? 'on' : 'off'}`)
      },
      onExamRushChange: (on) => {
        rushStorage
          .set('examRushMode', on)
          .catch((err) => logger.error('failed to persist examRushMode:', err))
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
  registry.register(infiniteSessionModule)
  registry.register(courseStoreModule)
  registry.register(examSignupModule)
  registry.register(pinkModeModule)

  // Activate modules for current page
  await registry.activateAll(buildContext())

  // Track last path for detecting post-login navigation
  let lastPath = extractPath(window.location.href)

  // Observe SPA route changes and re-evaluate modules on navigation
  observeRouteChanges(bus)
  bus.on('page:changed', async (payload) => {
    logger.info(`route changed: ${window.location.pathname}`)

    const previousPath = lastPath
    lastPath = payload.path

    // --- Rush mode post-login redirect ---
    // Detect login success: navigated away from /login to any other page
    const wasOnLogin = previousPath === '/login' || previousPath.endsWith('/login')
    const leftLogin = wasOnLogin && !payload.path.includes('/login')

    if (leftLogin) {
      const courseRush = statusPanel.getCourseRushMode()
      const examRush = statusPanel.getExamRushMode()

      if (courseRush) {
        logger.info('Course Rush Mode: redirecting to registration page after login')
        statusPanel.addMessage('info', 'Opening course registration for Course Rush...')
        registry.disposeAll()
        // Full navigation — Angular will initialize fresh on the new page
        const pathPrefix = window.location.pathname.split('/')[1] || 'hallgatoi'
        window.location.href = `${window.location.origin}/${pathPrefix}/subjects/registration`
        return
      } else if (examRush) {
        logger.info('Exam Rush Mode: redirecting to exam overview after login')
        statusPanel.addMessage('info', 'Opening exam overview for Exam Rush...')
        registry.disposeAll()
        const pathPrefix = window.location.pathname.split('/')[1] || 'hallgatoi'
        window.location.href = `${window.location.origin}/${pathPrefix}/exams/overview/registration`
        return
      }
    }

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
