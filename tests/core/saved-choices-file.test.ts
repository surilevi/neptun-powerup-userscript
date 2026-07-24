// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadSavedChoicesBackup,
  savedChoicesBackupFilename,
} from '../../src/core/saved-choices-file'
import { SAVED_CHOICES_SCHEMA, type SavedChoicesBackup } from '../../src/core/saved-choices'

const backup: SavedChoicesBackup = {
  schema: SAVED_CHOICES_SCHEMA,
  exportedAt: '2026-07-24T12:00:00.000Z',
  courseSelections: {},
  examPreferences: {},
}

describe('saved choices file handling', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('builds a stable dated JSON filename', () => {
    expect(savedChoicesBackupFilename(backup.exportedAt)).toBe('npu-saved-choices-2026-07-24.json')
  })

  it('downloads through a temporary object URL and cleans it up', () => {
    vi.useFakeTimers()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const objectUrlApi = {
      createObjectURL: vi.fn(() => 'blob:npu-backup'),
      revokeObjectURL: vi.fn(),
    }

    const filename = downloadSavedChoicesBackup(backup, document, objectUrlApi)

    expect(filename).toBe('npu-saved-choices-2026-07-24.json')
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download]')).toBeNull()
    expect(objectUrlApi.revokeObjectURL).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(objectUrlApi.revokeObjectURL).toHaveBeenCalledWith('blob:npu-backup')
  })
})
