import { getApi } from './state'
import {
  getSubjectPanels,
  isPanelExpanded,
  extractSubjectCode,
  getCourseItems,
  isCourseSelected,
  extractCourseCode,
} from './dom'
import { loadSelections, saveSelections } from './storage'
import { renderModuleUI } from './ui'

/**
 * SAVE: Read currently expanded panels and their checked courses, persist to storage.
 */
/**
 * Save merges with existing selections. You can expand one subject at a time,
 * pick courses, click Save, then expand the next subject and Save again.
 * Each save adds/updates that subject's courses without erasing others.
 */
export async function saveCurrentSelections(): Promise<void> {
  const api = getApi()
  const panels = getSubjectPanels()
  api?.logger.info(`[save-debug] found ${panels.length} panels on page`)

  const existing = await loadSelections()
  let newCount = 0

  for (const panel of panels) {
    const expanded = isPanelExpanded(panel)
    const headerText = (panel.querySelector('mat-expansion-panel-header')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50)
    const courseItemCount = panel.querySelectorAll('.course-list-item-container').length
    const selectedItemCount = panel.querySelectorAll('.course-list-item-container--selected').length

    api?.logger.info(
      `[save-debug] panel "${headerText}": expanded=${expanded}, courses=${courseItemCount}, selected=${selectedItemCount}, classes=${panel.className.substring(0, 60)}`,
    )

    if (!expanded) continue

    const code = extractSubjectCode(panel)
    api?.logger.info(`[save-debug]   subjectCode=${code}`)
    if (!code) continue

    const items = getCourseItems(panel)
    const selectedCodes: string[] = []

    for (const item of items) {
      const isSelected = isCourseSelected(item)
      const courseCode = extractCourseCode(item)
      api?.logger.info(
        `[save-debug]   course=${courseCode}, selected=${isSelected}, classes=${item.className.substring(0, 60)}`,
      )
      if (isSelected && courseCode) {
        selectedCodes.push(courseCode)
      }
    }

    if (selectedCodes.length > 0) {
      existing[code] = selectedCodes
      newCount++
      api?.logger.info(`[save-debug] saved ${selectedCodes.join(', ')} for ${code}`)
    }
  }

  if (newCount === 0) {
    api?.logger.warn('no selected courses found in expanded subjects')
    api?.statusPanel.addMessage(
      'warn',
      'No selected courses found. Expand a subject and select courses first.',
    )
    await renderModuleUI()
    return
  }

  await saveSelections(existing)
  const totalSubjects = Object.keys(existing).length
  api?.logger.info(`saved/updated ${newCount} subjects, total stored: ${totalSubjects}`, existing)
  api?.statusPanel.addMessage(
    'info',
    `Saved ${newCount} subject${newCount === 1 ? '' : 's'}. Total stored: ${totalSubjects}.`,
  )
  await renderModuleUI()
}
