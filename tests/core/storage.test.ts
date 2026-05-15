import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStorageService } from '../../src/core/storage'

// Mock GM.getValue/GM.setValue
const gmStore: Record<string, string> = {}

const gmMock = {
  getValue: vi.fn(async (key: string, defaultVal?: string) => gmStore[key] ?? defaultVal),
  setValue: vi.fn(async (key: string, value: string) => {
    gmStore[key] = value
  }),
}

describe('StorageService', () => {
  beforeEach(() => {
    Object.keys(gmStore).forEach((k) => delete gmStore[k])
    vi.clearAllMocks()
  })

  it('should return undefined for missing key', async () => {
    const storage = createStorageService(gmMock, 'example.hu')
    const result = await storage.get<string>('nonexistent')
    expect(result).toBeUndefined()
  })

  it('should store and retrieve a value', async () => {
    const storage = createStorageService(gmMock, 'example.hu')
    await storage.set('key1', { hello: 'world' })
    const result = await storage.get<{ hello: string }>('key1')
    expect(result).toEqual({ hello: 'world' })
  })

  it('should remove a value', async () => {
    const storage = createStorageService(gmMock, 'example.hu')
    await storage.set('key1', 'value')
    await storage.remove('key1')
    const result = await storage.get<string>('key1')
    expect(result).toBeUndefined()
  })

  it('should scope domain storage by domain', async () => {
    const storage = createStorageService(gmMock, 'uni-corvinus.hu')
    await storage.setForDomain('tokenExpiry', 12345)
    const result = await storage.getForDomain<number>('tokenExpiry')
    expect(result).toBe(12345)
  })

  it('should isolate domain storage across domains', async () => {
    const storage1 = createStorageService(gmMock, 'uni-corvinus.hu')
    const storage2 = createStorageService(gmMock, 'uni-obuda.hu')

    await storage1.setForDomain('tokenExpiry', 111)
    await storage2.setForDomain('tokenExpiry', 222)

    expect(await storage1.getForDomain<number>('tokenExpiry')).toBe(111)
    expect(await storage2.getForDomain<number>('tokenExpiry')).toBe(222)
  })

  it('should persist all data under the npu3 GM key', async () => {
    const storage = createStorageService(gmMock, 'example.hu')
    await storage.set('test', 'value')

    expect(gmMock.setValue).toHaveBeenCalledWith('npu3', expect.any(String))
    const stored = JSON.parse(gmStore['npu3'])
    expect(stored.test).toBe('value')
  })

  it('should serialize concurrent writes so settings are not lost', async () => {
    const storage = createStorageService(gmMock, 'example.hu')

    await Promise.all([
      storage.set('courseRushMode', true),
      storage.setForDomain('themeSettings', { enabled: true, color: 'blue' }),
    ])

    expect(await storage.get<boolean>('courseRushMode')).toBe(true)
    expect(
      await storage.getForDomain<{ enabled: boolean; color: string }>('themeSettings'),
    ).toEqual({
      enabled: true,
      color: 'blue',
    })
  })
})
