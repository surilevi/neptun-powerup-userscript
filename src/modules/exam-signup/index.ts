import type { NpuModule, ModuleApi, PageContext } from '../../types/modules'
import {
  setApi,
  setIsDisposed,
  getDebounceTimer,
  setDebounceTimer,
  getTableObserver,
  setTableObserver,
  setCachedSubjectCode,
  setIsEnrollmentInProgress,
} from './state'
import { getSubjectCode, clearHighlights } from './dom'
import { loadPreferences } from './storage'
import { waitForExamTable, autoEnrollSaved } from './enroll'
import { renderModuleUI } from './ui'
import { delay } from '../../utils/async'

export const examSignupModule: NpuModule = {
  id: 'exam-signup',
  name: 'Exam Quick Signup',
  description: 'Save exam dates and try enrolling them from the current page',

  shouldActivate(context: PageContext): boolean {
    return /\/exams\/overview\/registration\/?$/.test(context.path)
  },

  async initialize(moduleApi: ModuleApi): Promise<void> {
    setApi(moduleApi)
    setIsDisposed(false)
    setIsEnrollmentInProgress(false)
    const api = moduleApi

    const tableReady = await waitForExamTable(5000)
    if (!tableReady) {
      api.logger.warn('exam table not found after 5s')
      return
    }

    await renderModuleUI()

    const subjectCode = getSubjectCode()
    if (subjectCode) {
      const prefs = await loadPreferences()
      if (prefs[subjectCode]) {
        api.logger.info(`found saved exam preference for ${subjectCode}, ready to auto-enroll`)
      }
    }

    const rushOn = api.statusPanel.getExamRushMode()
    if (rushOn) {
      api.logger.info('Exam Rush Mode active - scanning visible exam tables for saved targets')
      api.statusPanel.addMessage('info', 'Scanning visible exam tables...')
      await delay(1000)
      autoEnrollSaved().catch((err) => api.logger.error('rush exam auto-enroll failed:', err))
    }

    api.logger.info('initialized on exam page')
  },

  dispose(): void {
    setIsDisposed(true)
    setIsEnrollmentInProgress(false)
    const timer = getDebounceTimer()
    if (timer) {
      clearTimeout(timer)
      setDebounceTimer(null)
    }
    getTableObserver()?.disconnect()
    setTableObserver(null)
    clearHighlights()
    document.querySelectorAll('.npu-exam-save-btn').forEach((b) => b.remove())
    document.querySelectorAll('.npu-exam-save-slot').forEach((slot) => slot.remove())
    document.querySelectorAll('.npu-exam-retry-btn').forEach((b) => b.remove())
    setCachedSubjectCode(undefined)
    setApi(null)
  },
}
