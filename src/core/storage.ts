export interface GmStorage {
  getValue(key: string, defaultVal?: string): Promise<string | undefined>
  setValue(key: string, value: string): Promise<void>
}

export interface StorageService {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  getForDomain<T>(key: string): Promise<T | undefined>
  setForDomain<T>(key: string, value: T): Promise<void>
}

export function createStorageService(gm: GmStorage, domain: string): StorageService {
  async function loadAll(): Promise<Record<string, unknown>> {
    const raw = await gm.getValue('npu3')
    if (!raw) return {}
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      console.error('[NPU:storage] failed to parse stored data:', err)
      return {}
    }
  }

  async function saveAll(data: Record<string, unknown>): Promise<void> {
    try {
      await gm.setValue('npu3', JSON.stringify(data))
    } catch (err) {
      console.error('[NPU:storage] failed to save data:', err)
    }
  }

  // TODO: Read-modify-write without locking. If two set() calls run
  // concurrently, the second write may overwrite the first's changes.
  // Add a simple async mutex/queue if this becomes a practical problem.
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const data = await loadAll()
      return data[key] as T | undefined
    },

    async set<T>(key: string, value: T): Promise<void> {
      const data = await loadAll()
      data[key] = value
      await saveAll(data)
    },

    async remove(key: string): Promise<void> {
      const data = await loadAll()
      delete data[key]
      await saveAll(data)
    },

    async getForDomain<T>(key: string): Promise<T | undefined> {
      const data = await loadAll()
      const domainData = (data[`domain:${domain}`] ?? {}) as Record<string, unknown>
      return domainData[key] as T | undefined
    },

    async setForDomain<T>(key: string, value: T): Promise<void> {
      const data = await loadAll()
      const domainData = (data[`domain:${domain}`] ?? {}) as Record<string, unknown>
      domainData[key] = value
      data[`domain:${domain}`] = domainData
      await saveAll(data)
    },
  }
}
