import type { ModuleApi, NpuModule, PageContext } from '../../types/modules'

const STORAGE_KEY = 'versionWatch'
const RETEST_DETAIL =
  'Retest Course Store, Course Rush, Exam Signup, Exam Rush, and Infinite Session.'

interface VersionWatchState {
  lastSeenRaw: string
  lastSeenVersion: string
  acknowledgedRaw: string
  previousRaw?: string
}

export interface NeptunVersionInfo {
  raw: string
  version: string
  buildTime?: string
}

let api: ModuleApi | null = null
let observer: MutationObserver | null = null
let checkInFlight = false

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function parseNeptunVersionText(text: string): NeptunVersionInfo | null {
  const raw = normalizeText(text)
  const match = raw.match(/(?:verzió|verzio|version)\s*:\s*([^\s(]+)(?:\s*\(([^)]+)\))?/i)

  if (!match) return null

  return {
    raw,
    version: match[1],
    buildTime: match[2],
  }
}

export function findNeptunVersion(doc: Document = document): NeptunVersionInfo | null {
  const direct = doc.querySelector('.footer__version')
  const directVersion = direct ? parseNeptunVersionText(direct.textContent ?? '') : null
  if (directVersion) return directVersion

  const candidates = doc.querySelectorAll('[class*="version"], footer')
  for (const candidate of Array.from(candidates)) {
    const version = parseNeptunVersionText(candidate.textContent ?? '')
    if (version) return version
  }

  return null
}

async function acknowledgeVersion(current: NeptunVersionInfo): Promise<void> {
  if (!api) return

  const state = await api.storage.getForDomain<VersionWatchState>(STORAGE_KEY)
  await api.storage.setForDomain<VersionWatchState>(STORAGE_KEY, {
    lastSeenRaw: current.raw,
    lastSeenVersion: current.version,
    acknowledgedRaw: current.raw,
    previousRaw: state?.previousRaw,
  })
  api.statusPanel.setVersionWarning(null)
  api.statusPanel.addMessage('info', 'Neptun version marked as retested.')
}

function showWarning(
  current: NeptunVersionInfo,
  state: VersionWatchState,
  semanticChanged = state.lastSeenVersion !== current.version,
): void {
  if (!api) return

  api.statusPanel.setVersionWarning({
    title: semanticChanged ? 'Neptun version changed' : 'Neptun build changed',
    detail: semanticChanged ? RETEST_DETAIL : 'Quick smoke test recommended.',
    previous: state.previousRaw,
    current: current.raw,
    actionLabel: 'Mark Retested',
    onAction: () => acknowledgeVersion(current),
  })
  api.statusPanel.addMessage(
    'warn',
    semanticChanged ? 'Neptun version changed. Retest NPU features.' : 'Neptun build changed.',
  )
  api.statusPanel.expand()
}

async function checkCurrentVersion(): Promise<boolean> {
  if (!api || checkInFlight) return false

  const current = findNeptunVersion()
  if (!current) return false

  checkInFlight = true
  try {
    const state = await api.storage.getForDomain<VersionWatchState>(STORAGE_KEY)

    if (!state) {
      await api.storage.setForDomain<VersionWatchState>(STORAGE_KEY, {
        lastSeenRaw: current.raw,
        lastSeenVersion: current.version,
        acknowledgedRaw: current.raw,
      })
      api.logger.info(`stored initial Neptun version: ${current.raw}`)
      return true
    }

    if (state.lastSeenRaw !== current.raw) {
      const semanticChanged = state.lastSeenVersion !== current.version
      const nextState: VersionWatchState = {
        lastSeenRaw: current.raw,
        lastSeenVersion: current.version,
        acknowledgedRaw: state.acknowledgedRaw,
        previousRaw: state.lastSeenRaw,
      }
      await api.storage.setForDomain(STORAGE_KEY, nextState)
      showWarning(current, nextState, semanticChanged)
      return true
    }

    if (state.acknowledgedRaw !== current.raw) {
      showWarning(current, state)
      return true
    }

    api.statusPanel.setVersionWarning(null)
    return true
  } finally {
    checkInFlight = false
  }
}

function startObserver(): void {
  if (observer || !document.body) return

  observer = new MutationObserver(() => {
    void checkCurrentVersion().then((found) => {
      if (found) {
        observer?.disconnect()
        observer = null
      }
    })
  })

  observer.observe(document.body, { childList: true, subtree: true })
}

export const versionWatchModule: NpuModule = {
  id: 'version-watch',
  name: 'Version Watch',
  description: 'Warns when the Neptun footer version changes so NPU can be retested',

  shouldActivate(_context: PageContext): boolean {
    return true
  },

  async initialize(moduleApi: ModuleApi): Promise<void> {
    api = moduleApi
    const found = await checkCurrentVersion()
    if (!found) startObserver()
  },

  dispose(): void {
    observer?.disconnect()
    observer = null
    checkInFlight = false
    api?.statusPanel.setVersionWarning(null)
    api = null
  },
}
