// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import {
  autoEnrollSaved,
  waitForConfirmButton,
  waitForExamTable,
} from '../../src/modules/exam-signup/enroll'
import {
  setApi,
  setIsDisposed,
  setIsEnrollmentInProgress,
} from '../../src/modules/exam-signup/state'

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
      setVersionWarning: vi.fn(),
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

function appendOverlayDialog(
  text: string,
  buttonText: string,
  disabled = false,
): HTMLButtonElement {
  const overlay = document.createElement('div')
  overlay.className = 'cdk-overlay-container'
  const dialog = document.createElement('div')
  dialog.className = 'cdk-overlay-pane'
  const message = document.createElement('p')
  message.textContent = text
  const button = document.createElement('button')
  button.textContent = buttonText
  button.disabled = disabled
  dialog.append(message, button)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)
  return button
}

describe('exam-signup confirmation wait', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setIsDisposed(false)
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
      confirmBtn = appendOverlayDialog('Vizsga jelentkezes megerositese', 'Igen')
    }, 125)

    await vi.advanceTimersByTimeAsync(125)

    await expect(promise).resolves.toBe(confirmBtn)
  })

  it('uses a slow-network friendly default confirmation wait', async () => {
    vi.useFakeTimers()
    let confirmBtn: HTMLButtonElement | null = null
    const promise = waitForConfirmButton()

    setTimeout(() => {
      confirmBtn = appendOverlayDialog('Exam registration confirmation', 'Confirm')
    }, 2500)

    await vi.advanceTimersByTimeAsync(2500)

    await expect(promise).resolves.toBe(confirmBtn)
  })

  it('waits until the confirmation button is interactable', async () => {
    vi.useFakeTimers()

    const confirmBtn = appendOverlayDialog('Vizsga jelentkezes megerositese', 'Megerősít', true)
    confirmBtn.textContent = 'Megerősít'
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

  it('ignores generic confirmation dialogs that are not about exam registration', async () => {
    vi.useFakeTimers()
    const promise = waitForConfirmButton(1000)

    setTimeout(() => {
      appendOverlayDialog('Session timeout warning', 'OK')
    }, 100)

    await vi.advanceTimersByTimeAsync(200)
    let resolved = false
    promise.then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)

    let confirmBtn: HTMLButtonElement | null = null
    setTimeout(() => {
      confirmBtn = appendOverlayDialog('Exam registration confirmation', 'OK')
    }, 100)

    await vi.advanceTimersByTimeAsync(100)
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

  it('waits for saved exam targets that render after the first scan', async () => {
    vi.useFakeTimers()
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
                    name: 'https://neptun.bme.hu/hallgatoi/api/ExamRegistration/SignUpForExam',
                    responseStatus: 200,
                    startTime: performance.now(),
                  },
                ],
              } as unknown as PerformanceObserverEntryList,
              this as unknown as PerformanceObserver,
            )
          }, 100)
        }
        observe() {}
        disconnect() {}
      },
    )

    const api = createMockApi()
    const savedPrefs = {
      'BMEGT00A001-01': {
        date: '2026.06.01. 08:00',
        type: 'Irasbeli',
        courseCode: '',
      },
    }
    api.storage.getForDomain = async <T>(): Promise<T | undefined> => savedPrefs as T
    setApi(api)
    sessionStorage.setItem('access_token', 'token')

    document.body.innerHTML = '<main></main>'
    const clickSpy = vi.fn()
    const promise = autoEnrollSaved()

    setTimeout(() => {
      const main = document.querySelector('main')
      if (!main) return

      const heading = document.createElement('div')
      heading.textContent = 'BMEGT00A001-01'

      const table = document.createElement('table')
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>2026.06.01. 08:00</td>
        <td>Irasbeli</td>
        <td>0 / 20</td>
        <td></td>
      `
      const button = document.createElement('button')
      button.textContent = 'Felvetel'
      button.addEventListener('click', clickSpy)
      row.querySelector('td:last-child')?.appendChild(button)
      table.appendChild(row)
      main.append(heading, table)
    }, 6000)

    await vi.advanceTimersByTimeAsync(6500)
    await promise

    expect(clickSpy).toHaveBeenCalledOnce()
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'info',
      'Waiting for saved exam rows to finish loading...',
    )
    expect(api.statusPanel.addMessage).toHaveBeenCalledWith(
      'info',
      'Enrollment submitted for BMEGT00A001-01: 2026.06.01. 08:00.',
    )
  })
})

describe('exam-signup table wait', () => {
  afterEach(() => {
    vi.useRealTimers()
    setIsDisposed(false)
    setApi(null)
    document.body.innerHTML = ''
  })

  it('waits for exam rows that render after a delayed Angular load', async () => {
    vi.useFakeTimers()
    setApi(createMockApi())

    const promise = waitForExamTable(10_000)

    setTimeout(() => {
      document.body.innerHTML = `
        <main>
          <div>BMEGT00A001-01</div>
          <table>
            <tr>
              <td>2026.06.01. 08:00</td>
              <td>Irasbeli</td>
              <td>0 / 20</td>
              <td><button>Felvetel</button></td>
            </tr>
          </table>
        </main>
      `
    }, 6500)

    await vi.advanceTimersByTimeAsync(7000)

    await expect(promise).resolves.toBe(true)
  })
})
