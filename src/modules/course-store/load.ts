import { getApi } from './state'
import {
  findSubjectPanel,
  extractCourseCode,
  expandPanel,
  getCourseItems,
  isCourseSelected,
  toggleCourse,
} from './dom'
import { loadSelections } from './storage'

/**
 * LOAD: For each stored subject, expand its panel and check the stored courses.
 */
export async function loadStoredSelections(): Promise<void> {
  const api = getApi()
  const selections = await loadSelections()
  const subjectCodes = Object.keys(selections)

  if (subjectCodes.length === 0) {
    api?.logger.info('no stored selections to load')
    api?.statusPanel.addMessage('info', 'No saved course selections found.')
    return
  }

  api?.logger.info(`loading selections for ${subjectCodes.length} subjects`)
  api?.statusPanel.addMessage(
    'info',
    `Loading ${subjectCodes.length} saved subject${subjectCodes.length === 1 ? '' : 's'}...`,
  )
  api?.logger.info(
    `[load-debug] loadStoredSelections: preparing to match ${subjectCodes.length} stored subjects on the live page`,
  )

  let loadedCount = 0

  for (const subjectCode of subjectCodes) {
    const courseCodes = selections[subjectCode]
    const panel = findSubjectPanel(subjectCode)

    if (!panel) {
      api?.logger.warn(
        `[load-debug] loadStoredSelections: subject ${subjectCode} not found on the live page - skipping`,
      )
      continue
    }

    api?.logger.info(`[load-debug] loadStoredSelections: expanding panel for ${subjectCode}...`)
    const expanded = await expandPanel(panel)
    if (!expanded) {
      api?.logger.warn(`[load-debug] loadStoredSelections: expansion failed for ${subjectCode}`)
      continue
    }
    api?.logger.info(`[load-debug] loadStoredSelections: panel expanded for ${subjectCode}`)

    let matchedCourses = 0

    for (const courseCode of courseCodes) {
      const livePanel = findSubjectPanel(subjectCode)
      if (!livePanel) {
        api?.logger.warn(
          `[load-debug] loadStoredSelections: subject ${subjectCode} disappeared after expansion`,
        )
        break
      }

      const items = getCourseItems(livePanel)
      api?.logger.info(
        `[load-debug] loadStoredSelections: ${items.length} live course items in ${subjectCode}, matching ${courseCode}`,
      )

      const item = items.find((candidate) => extractCourseCode(candidate) === courseCode)
      if (!item) {
        api?.logger.warn(
          `[load-debug] loadStoredSelections: course ${courseCode} not found in ${subjectCode}`,
        )
        continue
      }

      if (!isCourseSelected(item)) {
        await toggleCourse(item)
        api?.logger.info(
          `[load-debug] loadStoredSelections: toggled course ${courseCode} in ${subjectCode}`,
        )
      } else {
        api?.logger.info(
          `[load-debug] loadStoredSelections: course ${courseCode} already selected in ${subjectCode}`,
        )
      }
      matchedCourses++
    }

    api?.logger.info(
      `[load-debug] loadStoredSelections: matched ${matchedCourses}/${courseCodes.length} courses for ${subjectCode}`,
    )
    if (matchedCourses > 0) loadedCount++

    const verificationPanel = findSubjectPanel(subjectCode)
    const actualSelected = verificationPanel
      ? getCourseItems(verificationPanel).filter((item) => isCourseSelected(item)).length
      : 0

    if (verificationPanel && actualSelected !== courseCodes.length) {
      const mismatchMsg = `${subjectCode}: ${actualSelected} selected in DOM vs ${courseCodes.length} requested`
      api?.logger.warn(`[load-debug] loadStoredSelections: selection mismatch - ${mismatchMsg}`)
      api?.statusPanel.addMessage('warn', `Selection mismatch: ${mismatchMsg}`)
    }
  }

  api?.logger.info(`loaded selections for ${loadedCount} / ${subjectCodes.length} subjects`)
  api?.statusPanel.addMessage(
    'info',
    `Loaded ${loadedCount}/${subjectCodes.length}. Review, then use Enroll Selected or enroll manually.`,
  )
}
