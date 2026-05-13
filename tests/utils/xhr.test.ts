// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { waitForRequestComplete } from '../../src/utils/xhr'

describe('waitForRequestComplete', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should resolve completion info when a matching resource entry appears', async () => {
    // Mock PerformanceObserver to simulate a matching request
    const mockDisconnect = vi.fn()
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        private callback: PerformanceObserverCallback
        constructor(callback: PerformanceObserverCallback) {
          this.callback = callback
          // Simulate a matching entry arriving after construction
          setTimeout(() => {
            this.callback(
              {
                getEntries: () => [
                  {
                    name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SubjectSignin',
                    responseStatus: 200,
                  },
                ],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 10)
        }
        observe() {}
        disconnect = mockDisconnect
      },
    )

    const result = await waitForRequestComplete('SubjectSignin', 5000)
    expect(result).toEqual({ completed: true, status: 200 })
    expect(mockDisconnect).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('should resolve timeout info when no matching request appears', async () => {
    vi.useFakeTimers()

    const mockDisconnect = vi.fn()
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        constructor() {}
        observe() {}
        disconnect = mockDisconnect
      },
    )

    const promise = waitForRequestComplete('SubjectSignin', 1000)
    vi.advanceTimersByTime(1000)

    const result = await promise
    expect(result).toEqual({ completed: false, status: null })
    expect(mockDisconnect).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('should not match requests with different URLs', async () => {
    vi.useFakeTimers()

    vi.stubGlobal(
      'PerformanceObserver',
      class {
        private callback: PerformanceObserverCallback
        constructor(callback: PerformanceObserverCallback) {
          this.callback = callback
          // Simulate a NON-matching entry
          setTimeout(() => {
            this.callback(
              {
                getEntries: () => [
                  { name: 'https://neptun.bme.hu/hallgatoi/api/Message/GetUnreadedMessagesCount' },
                ],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 10)
        }
        observe() {}
        disconnect() {}
      },
    )

    const promise = waitForRequestComplete('SubjectSignin', 1000)
    vi.advanceTimersByTime(10) // Let the non-matching entry fire
    vi.advanceTimersByTime(1000) // Timeout

    const result = await promise
    expect(result).toEqual({ completed: false, status: null })

    vi.unstubAllGlobals()
  })

  it('should surface HTTP error status when available', async () => {
    const mockDisconnect = vi.fn()
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        private callback: PerformanceObserverCallback
        constructor(callback: PerformanceObserverCallback) {
          this.callback = callback
          setTimeout(() => {
            this.callback(
              {
                getEntries: () => [
                  {
                    name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SubjectSignin',
                    responseStatus: 500,
                  },
                ],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 10)
        }
        observe() {}
        disconnect = mockDisconnect
      },
    )

    const result = await waitForRequestComplete('SubjectSignin', 1000)
    expect(result).toEqual({ completed: true, status: 500 })

    vi.unstubAllGlobals()
  })

  it('should resolve an existing fresh matching resource entry', async () => {
    const freshEntry = {
      name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SubjectSignin',
      responseStatus: 200,
      startTime: 25,
    } as unknown as PerformanceEntry

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([freshEntry])

    const result = await waitForRequestComplete('SubjectSignin', 1000, 10)
    expect(result).toEqual({ completed: true, status: 200 })
  })

  it('should fall back to polling performance entries when PerformanceObserver is unavailable', async () => {
    vi.useFakeTimers()

    const freshEntry = {
      name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SubjectSignin',
      responseStatus: 200,
      startTime: 25,
    } as unknown as PerformanceEntry

    let calls = 0
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      calls++
      return calls > 1 ? [freshEntry] : []
    })
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        constructor() {
          throw new Error('PerformanceObserver unavailable')
        }
      },
    )

    const promise = waitForRequestComplete('SubjectSignin', 1000, 10)
    await vi.advanceTimersByTimeAsync(100)

    await expect(promise).resolves.toEqual({ completed: true, status: 200 })

    vi.unstubAllGlobals()
  })

  it('should ignore stale matching resource entries before the tracked start time', async () => {
    const staleEntry = {
      name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SubjectSignin',
      responseStatus: 200,
      startTime: 5,
    } as unknown as PerformanceEntry

    const freshEntry = {
      name: 'https://neptun.bme.hu/hallgatoi/api/SubjectApplication/SubjectSignin',
      responseStatus: 201,
      startTime: 25,
    } as unknown as PerformanceEntry

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([staleEntry])

    vi.stubGlobal(
      'PerformanceObserver',
      class {
        private callback: PerformanceObserverCallback
        constructor(callback: PerformanceObserverCallback) {
          this.callback = callback
          setTimeout(() => {
            this.callback(
              {
                getEntries: () => [freshEntry],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 10)
        }
        observe() {}
        disconnect() {}
      },
    )

    const result = await waitForRequestComplete('SubjectSignin', 1000, 10)
    expect(result).toEqual({ completed: true, status: 201 })

    vi.unstubAllGlobals()
  })
})
