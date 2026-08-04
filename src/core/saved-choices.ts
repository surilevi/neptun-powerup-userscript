import type { StorageService } from './storage'
import type { CourseSelections } from '../modules/course-store/state'
import type { ExamPreferences } from '../modules/exam-signup/state'

export const SAVED_CHOICES_SCHEMA = 'npu.saved-choices.v1'
export const MAX_SAVED_CHOICES_BACKUP_SIZE = 1_000_000

const COURSE_SELECTIONS_KEY = 'courseSelections'
const EXAM_PREFERENCES_KEY = 'examPreferences'
const MAX_CODE_LENGTH = 200
const MAX_EXAM_FIELD_LENGTH = 500
const MAX_SUBJECTS = 2_000
const MAX_COURSES_PER_SUBJECT = 2_000
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface SavedChoicesBackup {
  schema: typeof SAVED_CHOICES_SCHEMA
  exportedAt: string
  courseSelections: CourseSelections
  examPreferences: ExamPreferences
}

export interface SavedChoicesCount {
  subjects: number
  courses: number
  exams: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidRecordKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_CODE_LENGTH &&
    value.trim() === value &&
    !UNSAFE_RECORD_KEYS.has(value)
  )
}

function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function sanitizeCourseSelections(value: unknown): CourseSelections {
  if (!isRecord(value)) return {}

  const selections: CourseSelections = {}
  for (const [rawSubjectCode, rawCourseCodes] of Object.entries(value)) {
    const subjectCode = rawSubjectCode.trim()
    if (!isValidRecordKey(subjectCode) || !Array.isArray(rawCourseCodes)) continue

    const courseCodes = Array.from(
      new Set(
        rawCourseCodes
          .filter((courseCode): courseCode is string => typeof courseCode === 'string')
          .map((courseCode) => courseCode.trim())
          .filter((courseCode) => isValidRecordKey(courseCode)),
      ),
    ).slice(0, MAX_COURSES_PER_SUBJECT)

    if (courseCodes.length > 0) setOwn(selections, subjectCode, courseCodes)
    if (Object.keys(selections).length >= MAX_SUBJECTS) break
  }

  return selections
}

function sanitizeExamPreferences(value: unknown): ExamPreferences {
  if (!isRecord(value)) return {}

  const preferences: ExamPreferences = {}
  for (const [rawSubjectCode, rawPreference] of Object.entries(value)) {
    const subjectCode = rawSubjectCode.trim()
    if (!isValidRecordKey(subjectCode) || !isRecord(rawPreference)) continue

    const date = typeof rawPreference.date === 'string' ? rawPreference.date.trim() : ''
    if (date.length === 0 || date.length > MAX_EXAM_FIELD_LENGTH) continue

    const type =
      typeof rawPreference.type === 'string'
        ? rawPreference.type.trim().slice(0, MAX_EXAM_FIELD_LENGTH)
        : ''
    const courseCode =
      typeof rawPreference.courseCode === 'string'
        ? rawPreference.courseCode.trim().slice(0, MAX_CODE_LENGTH)
        : ''

    setOwn(preferences, subjectCode, { date, type, courseCode })
    if (Object.keys(preferences).length >= MAX_SUBJECTS) break
  }

  return preferences
}

function parseCourseSelections(value: unknown): CourseSelections {
  if (!isRecord(value)) {
    throw new Error('The backup has an invalid courseSelections section.')
  }

  const entries = Object.entries(value)
  if (entries.length > MAX_SUBJECTS) {
    throw new Error('The backup contains too many saved subjects.')
  }

  const selections: CourseSelections = {}
  for (const [subjectCode, courseCodes] of entries) {
    if (!isValidRecordKey(subjectCode) || !Array.isArray(courseCodes)) {
      throw new Error(`The backup has an invalid course selection for "${subjectCode}".`)
    }
    if (courseCodes.length === 0 || courseCodes.length > MAX_COURSES_PER_SUBJECT) {
      throw new Error(`The backup has an invalid course list for "${subjectCode}".`)
    }

    const cleanCodes: string[] = []
    const seen = new Set<string>()
    for (const courseCode of courseCodes) {
      if (typeof courseCode !== 'string' || !isValidRecordKey(courseCode) || seen.has(courseCode)) {
        throw new Error(`The backup has an invalid course code for "${subjectCode}".`)
      }
      seen.add(courseCode)
      cleanCodes.push(courseCode)
    }
    setOwn(selections, subjectCode, cleanCodes)
  }

  return selections
}

function parseExamPreferences(value: unknown): ExamPreferences {
  if (!isRecord(value)) {
    throw new Error('The backup has an invalid examPreferences section.')
  }

  const entries = Object.entries(value)
  if (entries.length > MAX_SUBJECTS) {
    throw new Error('The backup contains too many saved exams.')
  }

  const preferences: ExamPreferences = {}
  for (const [subjectCode, preference] of entries) {
    if (!isValidRecordKey(subjectCode) || !isRecord(preference)) {
      throw new Error(`The backup has an invalid exam preference for "${subjectCode}".`)
    }

    const { date, type, courseCode } = preference
    if (
      typeof date !== 'string' ||
      date.length === 0 ||
      date.trim() !== date ||
      date.length > MAX_EXAM_FIELD_LENGTH ||
      typeof type !== 'string' ||
      type.trim() !== type ||
      type.length > MAX_EXAM_FIELD_LENGTH ||
      typeof courseCode !== 'string' ||
      courseCode.trim() !== courseCode ||
      courseCode.length > MAX_CODE_LENGTH
    ) {
      throw new Error(`The backup has an invalid exam preference for "${subjectCode}".`)
    }

    setOwn(preferences, subjectCode, { date, type, courseCode })
  }

  return preferences
}

export async function createSavedChoicesBackup(
  storage: StorageService,
  exportedAt = new Date(),
): Promise<SavedChoicesBackup> {
  const [courseSelections, examPreferences] = await Promise.all([
    storage.getForDomain<CourseSelections>(COURSE_SELECTIONS_KEY),
    storage.getForDomain<ExamPreferences>(EXAM_PREFERENCES_KEY),
  ])

  return {
    schema: SAVED_CHOICES_SCHEMA,
    exportedAt: exportedAt.toISOString(),
    courseSelections: sanitizeCourseSelections(courseSelections),
    examPreferences: sanitizeExamPreferences(examPreferences),
  }
}

export function serializeSavedChoicesBackup(backup: SavedChoicesBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export function parseSavedChoicesBackup(text: string): SavedChoicesBackup {
  if (text.length > MAX_SAVED_CHOICES_BACKUP_SIZE) {
    throw new Error('The selected backup is too large.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }

  if (!isRecord(parsed) || parsed.schema !== SAVED_CHOICES_SCHEMA) {
    throw new Error('The selected file is not a supported NPU saved choices backup.')
  }
  if (
    typeof parsed.exportedAt !== 'string' ||
    parsed.exportedAt.length === 0 ||
    !Number.isFinite(Date.parse(parsed.exportedAt))
  ) {
    throw new Error('The backup has an invalid export date.')
  }

  return {
    schema: SAVED_CHOICES_SCHEMA,
    exportedAt: parsed.exportedAt,
    courseSelections: parseCourseSelections(parsed.courseSelections),
    examPreferences: parseExamPreferences(parsed.examPreferences),
  }
}

export async function restoreSavedChoicesBackup(
  storage: StorageService,
  backup: SavedChoicesBackup,
): Promise<void> {
  const values = {
    [COURSE_SELECTIONS_KEY]: backup.courseSelections,
    [EXAM_PREFERENCES_KEY]: backup.examPreferences,
  }

  if (storage.setForDomainValues) {
    await storage.setForDomainValues(values)
    return
  }

  await storage.setForDomain(COURSE_SELECTIONS_KEY, backup.courseSelections)
  await storage.setForDomain(EXAM_PREFERENCES_KEY, backup.examPreferences)
}

export function countSavedChoices(backup: SavedChoicesBackup): SavedChoicesCount {
  return {
    subjects: Object.keys(backup.courseSelections).length,
    courses: Object.values(backup.courseSelections).reduce((sum, codes) => sum + codes.length, 0),
    exams: Object.keys(backup.examPreferences).length,
  }
}
