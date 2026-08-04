import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SAVED_CHOICES_BACKUP_SIZE,
  SAVED_CHOICES_SCHEMA,
  countSavedChoices,
  createSavedChoicesBackup,
  parseSavedChoicesBackup,
  restoreSavedChoicesBackup,
  serializeSavedChoicesBackup,
  type SavedChoicesBackup,
} from '../../src/core/saved-choices'
import type { StorageService } from '../../src/core/storage'

function createStorage(initial: Record<string, unknown> = {}): StorageService {
  const domainStore = { ...initial }

  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    getForDomain: async <T>(key: string): Promise<T | undefined> => {
      return domainStore[key] as T | undefined
    },
    setForDomain: vi.fn(async (key: string, value: unknown) => {
      domainStore[key] = value
    }),
    setForDomainValues: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(domainStore, values)
    }),
  }
}

function validBackup(overrides: Partial<SavedChoicesBackup> = {}): SavedChoicesBackup {
  return {
    schema: SAVED_CHOICES_SCHEMA,
    exportedAt: '2026-07-24T12:00:00.000Z',
    courseSelections: { ABC12DE345: ['NE1'] },
    examPreferences: {
      ABC12DE345: {
        date: '2026. június 8. 8:00',
        type: 'Írásbeli',
        courseCode: 'E1',
      },
    },
    ...overrides,
  }
}

describe('saved choices backup', () => {
  it('exports sanitized, deduplicated saved courses and exams', async () => {
    const storage = createStorage({
      courseSelections: {
        ' ABC12DE345 ': [' NE1 ', 'NE1', '', 12],
        BROKEN: 'not-an-array',
      },
      examPreferences: {
        ' ABC12DE345 ': {
          date: ' 2026. június 8. 8:00 ',
          type: ' Írásbeli ',
          courseCode: ' E1 ',
        },
        BROKEN: { type: 'Missing date' },
      },
    })

    const backup = await createSavedChoicesBackup(storage, new Date('2026-07-24T12:00:00.000Z'))

    expect(backup).toEqual(validBackup())
    expect(countSavedChoices(backup)).toEqual({ subjects: 1, courses: 1, exams: 1 })
  })

  it('serializes and parses a valid versioned backup', () => {
    const backup = validBackup()
    const serialized = serializeSavedChoicesBackup(backup)

    expect(serialized.endsWith('\n')).toBe(true)
    expect(parseSavedChoicesBackup(serialized)).toEqual(backup)
  })

  it.each([
    ['malformed JSON', '{', 'not valid JSON'],
    [
      'an unknown schema',
      JSON.stringify({ ...validBackup(), schema: 'npu.saved-choices.v2' }),
      'not a supported',
    ],
    [
      'a missing course section',
      JSON.stringify({ ...validBackup(), courseSelections: undefined }),
      'courseSelections',
    ],
    [
      'an invalid export date',
      JSON.stringify({ ...validBackup(), exportedAt: 'not-a-date' }),
      'invalid export date',
    ],
    [
      'an empty course list',
      JSON.stringify({ ...validBackup(), courseSelections: { ABC12DE345: [] } }),
      'invalid course list',
    ],
    [
      'a partial exam preference',
      JSON.stringify({
        ...validBackup(),
        examPreferences: { ABC12DE345: { date: '2026. június 8. 8:00' } },
      }),
      'invalid exam preference',
    ],
  ])('rejects %s', (_name, json, expectedMessage) => {
    expect(() => parseSavedChoicesBackup(json)).toThrow(expectedMessage)
  })

  it('rejects oversized files before parsing', () => {
    expect(() => parseSavedChoicesBackup(' '.repeat(MAX_SAVED_CHOICES_BACKUP_SIZE + 1))).toThrow(
      'too large',
    )
  })

  it('allows an intentional empty backup', () => {
    const backup = validBackup({ courseSelections: {}, examPreferences: {} })

    expect(parseSavedChoicesBackup(JSON.stringify(backup))).toEqual(backup)
    expect(countSavedChoices(backup)).toEqual({ subjects: 0, courses: 0, exams: 0 })
  })

  it('restores course and exam choices in one domain-storage transaction', async () => {
    const storage = createStorage()
    const backup = validBackup()

    await restoreSavedChoicesBackup(storage, backup)

    expect(storage.setForDomainValues).toHaveBeenCalledWith({
      courseSelections: backup.courseSelections,
      examPreferences: backup.examPreferences,
    })
    expect(storage.setForDomain).not.toHaveBeenCalled()
  })

  it('supports StorageService implementations without the batch method', async () => {
    const storage = createStorage()
    delete storage.setForDomainValues
    const backup = validBackup()

    await restoreSavedChoicesBackup(storage, backup)

    expect(storage.setForDomain).toHaveBeenNthCalledWith(
      1,
      'courseSelections',
      backup.courseSelections,
    )
    expect(storage.setForDomain).toHaveBeenNthCalledWith(
      2,
      'examPreferences',
      backup.examPreferences,
    )
  })
})
