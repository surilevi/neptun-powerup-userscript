import { getApi, getIsEnrolling } from './state'
import { loadSelections, clearSelections, removeSingleSubject } from './storage'
import { saveCurrentSelections } from './save'
import { loadStoredSelections } from './load'
import { loadAndEnroll, quickEnrollAll } from './enroll'
import { enrollPlannedCourses } from './planner-enroll'
import { clearCoursePreview, previewPlannedCourses, previewSavedCourses } from './preview'
import { isDebugEnabled } from '../../utils/debug'

const COURSE_UI_BUILD = '3.4.0 planner-first'

/**
 * Build and set the module content for the unified status panel.
 * Shows save/load/enroll/clear buttons and saved selection details.
 */
export async function renderModuleUI(): Promise<void> {
  const api = getApi()
  if (!api) return

  clearCoursePreview()

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

  const plannerPreviewBtn = document.createElement('button')
  plannerPreviewBtn.style.cssText = `${btnStyle} background: #37474f; color: white;`
  plannerPreviewBtn.textContent = 'Preview Planner'
  plannerPreviewBtn.title =
    'Open Neptun timetable planner list view and highlight its exact planned courses without changing selections or enrolling'
  plannerPreviewBtn.addEventListener('click', () => {
    previewPlannedCourses().catch((err) => api?.logger.error('planner preview failed:', err))
  })
  btnContainer.appendChild(plannerPreviewBtn)

  const plannerEnrollBtn = document.createElement('button')
  plannerEnrollBtn.style.cssText = `${btnStyle} background: #d84315; color: white; font-weight: bold;`
  plannerEnrollBtn.textContent = 'Enroll Planner'
  plannerEnrollBtn.title =
    'Immediately revalidate the exact timetable-planner courses, then click every valid visible enrollment button sequentially'
  plannerEnrollBtn.addEventListener('click', () => {
    if (getIsEnrolling()) return
    enrollPlannedCourses().catch((err) => api?.logger.error('planner enrollment failed:', err))
  })
  btnContainer.appendChild(plannerEnrollBtn)

  const clearPreviewBtn = document.createElement('button')
  clearPreviewBtn.style.cssText = `${btnStyle} background: #455a64; color: white;`
  clearPreviewBtn.textContent = 'Clear Preview'
  clearPreviewBtn.addEventListener('click', () => {
    clearCoursePreview()
    api.statusPanel.addMessage('info', 'Course preview cleared.')
  })
  btnContainer.appendChild(clearPreviewBtn)

  // Local saved-selection fallback.
  const saveBtn = document.createElement('button')
  saveBtn.style.cssText = `${btnStyle} background: #1565c0; color: white;`
  saveBtn.textContent = 'Save Local'
  saveBtn.title = 'Save selections from the currently loaded subject list as a local fallback'
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

    const previewBtn = document.createElement('button')
    previewBtn.style.cssText = `${btnStyle} background: #37474f; color: white;`
    previewBtn.textContent = 'Preview Saved'
    previewBtn.title =
      'Expand saved subjects and highlight matches without clicking course or enrollment controls'
    previewBtn.addEventListener('click', () => {
      previewSavedCourses().catch((err) => api?.logger.error('course preview failed:', err))
    })
    btnContainer.appendChild(previewBtn)

    // Local saved-selection fallback enrollment.
    const loadEnrollBtn = document.createElement('button')
    loadEnrollBtn.style.cssText = `${btnStyle} background: #ad451e; color: white;`
    loadEnrollBtn.textContent = 'Local Load + Enroll'
    loadEnrollBtn.title =
      'Fallback: load locally saved courses from the subject list, then enroll each subject'
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
  hint.textContent =
    'Primary workflow: put exact courses in Neptun’s timetable planner, then Preview Planner. Enroll Planner starts immediately, never changes planner/course selections, and continues through every still-valid subject. Disable Neptun’s own registration popup first. Privacy-safe diagnostics are always logged under [NPU:planner]. Local buttons are the fallback.'
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
  clearCoursePreview()
  api?.logger.info('cleared all stored course selections')
  api?.statusPanel.addMessage('info', 'All stored selections cleared.')
  await renderModuleUI()
}
