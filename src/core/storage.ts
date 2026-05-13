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

let writeQueue: Promise<void> = Promise.resolve()

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

  function updateAll(mutator: (data: Record<string, unknown>) => void): Promise<void> {
    writeQueue = writeQueue
      .catch(() => undefined)
      .then(async () => {
        const data = await loadAll()
        mutator(data)
        await saveAll(data)
      })
    return writeQueue
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const data = await loadAll()
      return data[key] as T | undefined
    },

    async set<T>(key: string, value: T): Promise<void> {
      await updateAll((data) => {
        data[key] = value
      })
    },

    async remove(key: string): Promise<void> {
      await updateAll((data) => {
        delete data[key]
      })
    },

    async getForDomain<T>(key: string): Promise<T | undefined> {
      const data = await loadAll()
      const domainData = (data[`domain:${domain}`] ?? {}) as Record<string, unknown>
      return domainData[key] as T | undefined
    },

    async setForDomain<T>(key: string, value: T): Promise<void> {
      await updateAll((data) => {
        const domainData = (data[`domain:${domain}`] ?? {}) as Record<string, unknown>
        domainData[key] = value
        data[`domain:${domain}`] = domainData
      })
    },
  }
}
