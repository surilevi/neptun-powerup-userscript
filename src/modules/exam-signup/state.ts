import type { ModuleApi } from '../../types/modules'

export interface ExamPreferences {
  [subjectCode: string]: {
    date: string
    type: string
    courseCode: string
  }
}

export interface ExamRowInfo {
  row: HTMLTableRowElement
  date: string
  type: string
  capacity: string
  instructor: string
  courseCode: string
  felvetelBtn: HTMLButtonElement | null
}

export const STORAGE_KEY = 'examPreferences'
export const HIGHLIGHT_STYLE =
  'background-color: rgba(76, 175, 80, 0.15) !important; border-left: 3px solid #4caf50 !important;'

let api: ModuleApi | null = null
let tableObserver: MutationObserver | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let isDisposed = false
let isEnrollmentInProgress = false
let cachedSubjectCode: string | null | undefined = undefined

export function getApi(): ModuleApi | null {
  return api
}

export function setApi(value: ModuleApi | null): void {
  api = value
}

export function getTableObserver(): MutationObserver | null {
  return tableObserver
}

export function setTableObserver(value: MutationObserver | null): void {
  tableObserver = value
}

export function getDebounceTimer(): ReturnType<typeof setTimeout> | null {
  return debounceTimer
}

export function setDebounceTimer(value: ReturnType<typeof setTimeout> | null): void {
  debounceTimer = value
}

export function getIsDisposed(): boolean {
  return isDisposed
}

export function setIsDisposed(value: boolean): void {
  isDisposed = value
}

export function getIsEnrollmentInProgress(): boolean {
  return isEnrollmentInProgress
}

export function setIsEnrollmentInProgress(value: boolean): void {
  isEnrollmentInProgress = value
}

export function getCachedSubjectCode(): string | null | undefined {
  return cachedSubjectCode
}

export function setCachedSubjectCode(value: string | null | undefined): void {
  cachedSubjectCode = value
}
