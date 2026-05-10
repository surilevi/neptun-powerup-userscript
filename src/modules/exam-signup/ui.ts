import { getApi } from './state'
import { getSubjectCode, getSubjectName, highlightSavedRow, clearHighlights, addSaveButtonsToRows, watchTableForReRenders } from './dom'
import { loadPreferences, savePreferences } from './storage'
import { autoEnrollSaved } from './enroll'
import { isDebugEnabled } from '../../utils/debug'

const EXAM_UI_BUILD = '3.1.0 publish-prep-a'

async function savePreferredExam(subjectCode: string, date: string, type: string, courseCode: string): Promise<void> {
  const api = getApi()
  const prefs = await loadPreferences()
  prefs[subjectCode] = { date, type, courseCode }
  await savePreferences(prefs)
  api?.logger.info(`saved exam preference for ${subjectCode}: ${date}`)
  api?.statusPanel.addMessage('info', `Saved exam preference: ${date}`)
  await renderModuleUI()
}

async function clearPreference(subjectCode: string): Promise<void> {
  const api = getApi()
  const prefs = await loadPreferences()
  delete prefs[subjectCode]
  await savePreferences(prefs)
  api?.logger.info(`cleared exam preference for ${subjectCode}`)
  api?.statusPanel.addMessage('info', 'Exam preference cleared.')
  clearHighlights()
  await renderModuleUI()
}

export async function renderModuleUI(): Promise<void> {
  const api = getApi()
  if (!api) return

  const container = document.createElement('div')
  container.style.cssText = 'font-size: 12px;'
  const debugEnabled = isDebugEnabled()

  const heading = document.createElement('div')
  heading.style.cssText = 'font-weight: bold; color: #5c9eff; margin-bottom: 6px;'
  heading.textContent = 'Exam Quick Signup'
  container.appendChild(heading)

  if (debugEnabled) {
    const buildDiv = document.createElement('div')
    buildDiv.style.cssText = 'margin-top: -2px; margin-bottom: 6px; font-size: 10px; color: #6a7a8a;'
    buildDiv.textContent = `Build: ${EXAM_UI_BUILD}`
    container.appendChild(buildDiv)
  }

  const subjectCode = getSubjectCode()
  const subjectName = getSubjectName()
  const prefs = await loadPreferences()
  const currentPref = subjectCode ? prefs[subjectCode] : null

  const btnStyle = 'padding: 4px 10px; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; margin: 2px;'

  if (currentPref) {
    // Show saved preference
    const savedDiv = document.createElement('div')
    savedDiv.style.cssText = 'padding: 4px 6px; background: #0f2040; border-radius: 3px; margin-bottom: 6px; color: #8baae0; font-size: 11px;'
    savedDiv.textContent = `Saved: ${currentPref.date} (${subjectCode})`
    container.appendChild(savedDiv)

    // Auto-enroll button
    const autoBtn = document.createElement('button')
    autoBtn.style.cssText = `${btnStyle} background: #d84315; color: white; font-weight: bold;`
    autoBtn.textContent = 'Auto-Enroll Now'
    autoBtn.title = 'Click Felvétel on the saved exam date'
    autoBtn.addEventListener('click', () => {
      autoEnrollSaved().catch((err) => api?.logger.error('auto-enroll failed:', err))
    })
    container.appendChild(autoBtn)

    // Clear button
    const clearBtn = document.createElement('button')
    clearBtn.style.cssText = `${btnStyle} background: #c62828; color: white;`
    clearBtn.textContent = 'Clear'
    clearBtn.addEventListener('click', () => {
      if (subjectCode) {
        clearPreference(subjectCode).catch((err) => api?.logger.error('clear failed:', err))
      }
    })
    container.appendChild(clearBtn)

    // Highlight the saved row
    highlightSavedRow(currentPref)
  } else {
    // No saved preference — show instruction
    const infoDiv = document.createElement('div')
    infoDiv.style.cssText = 'color: #9e9e9e; margin-bottom: 6px;'
    infoDiv.textContent = 'Click "Save" under the exam date to set your preferred date.'
    container.appendChild(infoDiv)
  }

  // "View All Saved Exams" toggle
  const allPrefsEntries = Object.entries(prefs)
  if (allPrefsEntries.length > 0) {
    const toggleBtn = document.createElement('button')
    toggleBtn.style.cssText = `${btnStyle} background: #37474f; color: white; margin-top: 6px; display: block;`
    toggleBtn.textContent = `View all saved exams (${allPrefsEntries.length})`

    const allSavedDiv = document.createElement('div')
    allSavedDiv.style.cssText = 'display: none; padding: 6px; background: #0f2040; border-radius: 3px; margin-top: 4px; max-height: 120px; overflow-y: auto; font-size: 11px; color: #8baae0;'

    for (const [code, pref] of allPrefsEntries) {
      const row = document.createElement('div')
      row.style.cssText = 'padding: 2px 0; border-bottom: 1px solid #1a2a4a;'

      const text = document.createElement('span')
      text.textContent = `${code}: ${pref.date}`
      if (code === subjectCode) {
        text.style.fontWeight = 'bold'
        text.style.color = '#5c9eff'
      }
      row.appendChild(text)

      const removeBtn = document.createElement('button')
      removeBtn.style.cssText = 'margin-left: 8px; padding: 1px 6px; background: #c62828; color: white; border: none; border-radius: 2px; cursor: pointer; font-size: 10px;'
      removeBtn.textContent = 'x'
      removeBtn.title = `Remove saved exam for ${code}`
      removeBtn.addEventListener('click', () => {
        clearPreference(code).catch((err) => api?.logger.error('clear failed:', err))
      })
      row.appendChild(removeBtn)

      allSavedDiv.appendChild(row)
    }

    toggleBtn.addEventListener('click', () => {
      const isVisible = allSavedDiv.style.display !== 'none'
      allSavedDiv.style.display = isVisible ? 'none' : 'block'
      toggleBtn.textContent = isVisible
        ? `View all saved exams (${allPrefsEntries.length})`
        : `Hide saved exams`
    })

    container.appendChild(toggleBtn)
    container.appendChild(allSavedDiv)
  }

  // Add "Save" buttons to each exam row in the table
  const onSave = (sc: string, date: string, type: string, courseCode: string): void => {
    savePreferredExam(sc, date, type, courseCode).catch((err) =>
      api?.logger.error('save exam pref failed:', err),
    )
  }
  const injectionStats = addSaveButtonsToRows(subjectCode, onSave)

  // Watch for Angular table re-renders so save buttons are re-added
  watchTableForReRenders(subjectCode, onSave)

  if (debugEnabled) {
    const diagnosticsDiv = document.createElement('div')
    diagnosticsDiv.style.cssText = 'margin-top: 6px; font-size: 10px; color: #8baae0;'
    diagnosticsDiv.textContent = `Rows detected: ${injectionStats.rowCount} | Save buttons injected: ${injectionStats.addedCount}`
    container.appendChild(diagnosticsDiv)

    const overviewHintDiv = document.createElement('div')
    overviewHintDiv.style.cssText = 'margin-top: 4px; font-size: 10px; color: #6a7a8a;'
    overviewHintDiv.textContent = subjectCode
      ? `Current subject: ${subjectCode}`
      : 'Overview mode: Exam Rush scans all visible subject tables for saved targets.'
    container.appendChild(overviewHintDiv)
  }

  if (debugEnabled && subjectName) {
    const subjectDiv = document.createElement('div')
    subjectDiv.style.cssText = 'margin-top: 4px; font-size: 10px; color: #6a7a8a;'
    subjectDiv.textContent = `Subject: ${subjectName}`
    container.appendChild(subjectDiv)
  }

  api.statusPanel.setModuleContentElement(container)
}
