// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import { autoEnrollSaved, waitForConfirmButton } from '../../src/modules/exam-signup/enroll'
import { setApi, setIsEnrollmentInProgress } from '../../src/modules/exam-signup/state'

function createMockApi(): ModuleApi {
  return {
    bus: {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
      off: vi.fn(),
    },
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      getForDomain: vi.fn(async () => undefined),
      setForDomain: vi.fn(async () => {}),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    statusPanel: {
      setSessionStatus: vi.fn(),
      addMessage: vi.fn(),
      setModuleContent: vi.fn(),
      setModuleContentElement: vi.fn(),
      expand: vi.fn(),
      collapse: vi.fn(),
      toggle: vi.fn(),
      isExpanded: vi.fn(() => false),
      getCourseRushMode: vi.fn(() => false),
      setCourseRushMode: vi.fn(),
      getExamRushMode: vi.fn(() => false),
      setExamRushMode: vi.fn(),
      getThemeSettings: vi.fn(() => ({ enabled: false, color: 'pink' })),
      setThemeSettings: vi.fn(),
      onThemeSettingsChange: vi.fn(() => () => {}),
      dispose: vi.fn(),
    },
  }
}

describe('exam-signup confirmation wait', () => {
  afterEach(() => {
    vi.useRealTimers()
    setIsEnrollmentInProgress(false)
    setApi(null)
    sessionStorage.clear()
    document.body.innerHTML = ''
  })

  it('resolves as soon as a confirmation button appears', async () => {
    vi.useFakeTimers()
    let confirmBtn: HTMLButtonElement | null = null
    const promise = waitForConfirmButton(1000)

    setTimeout(() => {
      const overlay = document.createElement('div')
      overlay.className = 'cdk-overlay-container'
      confirmBtn = document.createElement('button')
      confirmBtn.textContent = 'Igen'
      overlay.appendChild(confirmBtn)
      document.body.appendChild(overlay)
    }, 125)

    await vi.advanceTimersByTimeAsync(125)

    await expect(promise).resolves.toBe(confirmBtn)
  })

  it('waits until the confirmation button is interactable', async () => {
    vi.useFakeTimers()

    const overlay = document.createElement('div')
    overlay.className = 'cdk-overlay-container'
    const confirmBtn = document.createElement('button')
    confirmBtn.textContent = 'Megerősít'
    confirmBtn.disabled = true
    overlay.appendChild(confirmBtn)
    document.body.appendChild(overlay)

    const promise = waitForConfirmButton(1000)
    let resolved = false
    promise.then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(false)

    confirmBtn.disabled = false
    await vi.advanceTimersByTimeAsync(50)

    await expect(promise).resolves.toBe(confirmBtn)
  })

  it('stops waiting when the registration request completes directly', async () => {
    vi.useFakeTimers()
    let finishRequest!: () => void
    const requestFinished = new Promise<void>((resolve) => {
      finishRequest = resolve
    })
    const promise = waitForConfirmButton(1000, requestFinished)

    finishRequest()
    await vi.advanceTimersByTimeAsync(0)

    await expect(promise).resolves.toBeNull()
  })

  it('does not attempt exam enrollment without a session token', async () => {
    const api = createMockApi()
    setApi(api)

    await autoEnrollSaved()

    expect(api.logger.warn).toHaveBeenCalledWith(
      'no access_token in sessionStorage - session may have expired',
    )
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'error',
      'Session expired. Log in again before enrolling.',
    )
  })
})
