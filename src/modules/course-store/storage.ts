import { getApi, STORAGE_KEY } from './state'
import type { CourseSelections } from './state'

export async function loadSelections(): Promise<CourseSelections> {
  const api = getApi()
  if (!api) return {}
  const data = await api.storage.getForDomain<CourseSelections>(STORAGE_KEY)
  return data ?? {}
}

export async function saveSelections(selections: CourseSelections): Promise<void> {
  const api = getApi()
  if (!api) return
  await api.storage.setForDomain(STORAGE_KEY, selections)
}

export async function clearSelections(): Promise<void> {
  const api = getApi()
  if (!api) return
  await api.storage.setForDomain(STORAGE_KEY, {})
}

export async function removeSingleSubject(subjectCode: string): Promise<void> {
  const api = getApi()
  if (!api) return // Don't touch storage if module is disposed — prevents data loss
  const existing = await loadSelections()
  delete existing[subjectCode]
  await saveSelections(existing)
  api.logger.info(`removed saved courses for ${subjectCode}`)
  api.statusPanel.addMessage('info', `Removed saved courses for ${subjectCode}.`)
}
