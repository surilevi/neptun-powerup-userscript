import { getApi, STORAGE_KEY } from './state'
import type { ExamPreferences } from './state'

export async function loadPreferences(): Promise<ExamPreferences> {
  const api = getApi()
  if (!api) return {}
  const raw = (await api.storage.getForDomain<ExamPreferences>(STORAGE_KEY)) ?? {}
  // Filter out invalid entries
  const valid: ExamPreferences = {}
  for (const [code, pref] of Object.entries(raw)) {
    if (pref && typeof pref.date === 'string' && pref.date.length > 0) {
      valid[code] = pref
    }
  }
  return valid
}

export async function savePreferences(prefs: ExamPreferences): Promise<void> {
  const api = getApi()
  if (!api) return
  await api.storage.setForDomain(STORAGE_KEY, prefs)
}
