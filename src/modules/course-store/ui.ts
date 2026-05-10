import { getApi, getIsEnrolling } from './state'
import { loadSelections, clearSelections, removeSingleSubject } from './storage'
import { saveCurrentSelections } from './save'
import { loadStoredSelections } from './load'
import { loadAndEnroll, quickEnrollAll } from './enroll'
import { isDebugEnabled } from '../../utils/debug'

const COURSE_UI_BUILD = '3.1.2 coursestore-select-a'

/**
 * Build and set the module content for the unified status panel.
 * Shows save/load/enroll/clear buttons and saved selection details.
 */
export async function renderModuleUI(): Promise<void> {
  const api = getApi()
  if (!api) return

  const container = document.createElement('div')
  const debugEnabled = isDebugEnabled()

  const titleDiv = document.createElement('div')
  titleDiv.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #5c9eff; font-size: 13px;'
  titleDiv.textContent = 'Course Store'
  container.appendChild(titleDiv)

  if (debugEnabled) {
    const buildDiv = document.createElement('div')
    buildDiv.style.cssText =
      'margin-top: -4px; margin-bottom: 6px; font-size: 10px; color: #6a7a8a;'
    buildDiv.textContent = `Build: ${COURSE_UI_BUILD}`
    container.appendChild(buildDiv)
  }

  const selections = await loadSelections()
  const hasStored = Object.keys(selections).length > 0
  const storedSubjectCount = Object.keys(selections).length
  const storedCourseCount = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0)

  const btnStyle = `
    padding: 5px 11px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
  `

  // Button container
  const btnContainer = document.createElement('div')
  btnContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px;'

  // Save button (always present)
  const saveBtn = document.createElement('button')
  saveBtn.style.cssText = `${btnStyle} background: #1565c0; color: white;`
  saveBtn.textContent = 'Save'
  saveBtn.addEventListener('click', () => {
    saveCurrentSelections().catch((err) => api?.logger.error('save selections failed:', err))
  })
  btnContainer.appendChild(saveBtn)

  if (hasStored) {
    const count = Object.keys(selections).length
    const courseCount = Object.values(selections).reduce((sum, arr) => sum + arr.length, 0)

    // Saved details — toggle view
    const toggleBtn = document.createElement('button')
    toggleBtn.style.cssText = `${btnStyle} background: #37474f; color: white; margin-bottom: 4px;`
    toggleBtn.textContent = `Saved (${count} subjects, ${courseCount} courses)`

    const detailDiv = document.createElement('div')
    detailDiv.style.cssText =
      'display: none; margin: 4px 0 6px; padding: 5px 7px; background: #0f2040; border-radius: 4px; font-size: 10px; color: #8baae0; max-height: 120px; overflow-y: auto; width: 100%;'

    for (const [subj, courses] of Object.entries(selections)) {
      const row = document.createElement('div')
      row.style.cssText =
        'padding: 2px 0; border-bottom: 1px solid #1a2a4a; display: flex; justify-content: space-between; align-items: center;'

      const text = document.createElement('span')
      text.textContent = `${subj}: ${courses.join(', ')}`
      row.appendChild(text)

      const removeBtn = document.createElement('button')
      removeBtn.style.cssText =
        'margin-left: 6px; padding: 1px 6px; background: #c62828; color: white; border: none; border-radius: 2px; cursor: pointer; font-size: 10px; flex-shrink: 0;'
      removeBtn.textContent = 'x'
      removeBtn.title = `Remove saved courses for ${subj}`
      removeBtn.addEventListener('click', () => {
        removeSingleSubject(subj)
          .then(() => renderModuleUI())
          .catch((err) => api?.logger.error('remove subject failed:', err))
      })
      row.appendChild(removeBtn)

      detailDiv.appendChild(row)
    }

    toggleBtn.addEventListener('click', () => {
      const isVisible = detailDiv.style.display !== 'none'
      detailDiv.style.display = isVisible ? 'none' : 'block'
      toggleBtn.textContent = isVisible
        ? `Saved (${count} subjects, ${courseCount} courses)`
        : 'Hide saved'
    })

    container.appendChild(toggleBtn)
    container.appendChild(detailDiv)

    // Load button
    const loadBtn = document.createElement('button')
    loadBtn.style.cssText = `${btnStyle} background: #2e7d32; color: white;`
    loadBtn.textContent = 'Load'
    loadBtn.addEventListener('click', () => {
      loadStoredSelections().catch((err) => api?.logger.error('load selections failed:', err))
    })
    btnContainer.appendChild(loadBtn)

    // Load & Enroll combo button — the registration rush button
    const loadEnrollBtn = document.createElement('button')
    loadEnrollBtn.style.cssText = `${btnStyle} background: #d84315; color: white; font-weight: bold;`
    loadEnrollBtn.textContent = 'Load + Enroll'
    loadEnrollBtn.title = 'Load saved courses, then enroll each subject'
    loadEnrollBtn.addEventListener('click', () => {
      if (getIsEnrolling()) return
      loadAndEnroll().catch((err) => api?.logger.error('load & enroll failed:', err))
    })
    btnContainer.appendChild(loadEnrollBtn)

    // Quick Enroll button (enroll already-selected courses without loading)
    const enrollBtn = document.createElement('button')
    enrollBtn.style.cssText = `${btnStyle} background: #e65100; color: white;`
    enrollBtn.textContent = 'Enroll Selected'
    enrollBtn.title = 'Enroll subjects with courses already selected'
    enrollBtn.addEventListener('click', () => {
      if (getIsEnrolling()) return
      quickEnrollAll().catch((err) => api?.logger.error('quick enroll failed:', err))
    })
    btnContainer.appendChild(enrollBtn)

    // Clear button
    const clearBtn = document.createElement('button')
    clearBtn.style.cssText = `${btnStyle} background: #c62828; color: white;`
    clearBtn.textContent = 'Clear Saved'
    clearBtn.addEventListener('click', () => {
      handleClear().catch((err) => api?.logger.error('clear selections failed:', err))
    })
    btnContainer.appendChild(clearBtn)
  }

  container.appendChild(btnContainer)

  const hint = document.createElement('div')
  hint.style.cssText = 'margin-top: 6px; font-size: 10px; color: #6a7a8a;'
  hint.textContent = 'Expand subjects and select courses before saving.'
  container.appendChild(hint)

  if (debugEnabled) {
    const diagnosticsDiv = document.createElement('div')
    diagnosticsDiv.style.cssText = 'margin-top: 4px; font-size: 10px; color: #8baae0;'
    diagnosticsDiv.textContent = `Stored subjects: ${storedSubjectCount} | Stored courses: ${storedCourseCount}`
    container.appendChild(diagnosticsDiv)

    const rushHintDiv = document.createElement('div')
    rushHintDiv.style.cssText = 'margin-top: 4px; font-size: 10px; color: #6a7a8a;'
    rushHintDiv.textContent = 'Course Rush turns off after a run starts.'
    container.appendChild(rushHintDiv)
  }

  api.statusPanel.setModuleContentElement(container)
}

async function handleClear(): Promise<void> {
  const api = getApi()
  await clearSelections()
  api?.logger.info('cleared all stored course selections')
  api?.statusPanel.addMessage('info', 'All stored selections cleared.')
  await renderModuleUI()
}
