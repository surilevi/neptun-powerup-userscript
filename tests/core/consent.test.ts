import { describe, it, expect, vi } from 'vitest'
import type { StorageService } from '../../src/core/storage'
import { hasConsent, storeConsent, resetConsent } from '../../src/core/consent'

function createMockStorage(): StorageService & {
  getForDomain: ReturnType<typeof vi.fn>
  setForDomain: ReturnType<typeof vi.fn>
} {
  const data: Record<string, unknown> = {}
  return {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    getForDomain: vi.fn(async (key: string) => data[key] as never),
    setForDomain: vi.fn(async (key: string, value: unknown) => { data[key] = value }),
  }
}

describe('consent', () => {
  it('hasConsent returns false when no consent stored', async () => {
    const storage = createMockStorage()
    expect(await hasConsent(storage)).toBe(false)
  })

  it('hasConsent returns true after storeConsent', async () => {
    const storage = createMockStorage()
    await storeConsent(storage)
    expect(await hasConsent(storage)).toBe(true)
  })

  it('hasConsent returns false after resetConsent', async () => {
    const storage = createMockStorage()
    await storeConsent(storage)
    expect(await hasConsent(storage)).toBe(true)
    await resetConsent(storage)
    expect(await hasConsent(storage)).toBe(false)
  })

  it('hasConsent returns false for non-boolean values', async () => {
    const storage = createMockStorage()
    // Simulate corrupted storage
    storage.getForDomain.mockResolvedValueOnce('yes')
    expect(await hasConsent(storage)).toBe(false)
  })
})
