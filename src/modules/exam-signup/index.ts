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
import { clearExamPreview } from './preview'
import { delay } from '../../utils/async'

const EXAM_TABLE_WAIT_MS = 30_000
const EXAM_RUSH_SETTLE_MS = 2_000

export const examSignupModule: NpuModule = {
  id: 'exam-signup',
  name: 'Exam Planner',
  description: 'Visualize registered exams, save preferred dates, and enroll them from the page',

  shouldActivate(context: PageContext): boolean {
    return /\/exams\/overview\/registration\/?$/.test(context.path)
  },

  async initialize(moduleApi: ModuleApi): Promise<void> {
    setApi(moduleApi)
    setIsDisposed(false)
    setIsEnrollmentInProgress(false)
    const api = moduleApi

    const tableReady = await waitForExamTable(EXAM_TABLE_WAIT_MS)
    if (!tableReady) {
      api.logger.warn(`exam table not found after ${EXAM_TABLE_WAIT_MS / 1000}s`)
      api.statusPanel.addMessage(
        'warn',
        'Exam table did not load yet. Refresh after Neptun finishes loading.',
      )
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
      await delay(EXAM_RUSH_SETTLE_MS)
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
    clearExamPreview()
    clearHighlights()
    document.querySelectorAll('.npu-exam-save-btn').forEach((b) => b.remove())
    document.querySelectorAll('.npu-exam-save-slot').forEach((slot) => slot.remove())
    document.querySelectorAll('.npu-exam-retry-btn').forEach((b) => b.remove())
    setCachedSubjectCode(undefined)
    setApi(null)
  },
}
