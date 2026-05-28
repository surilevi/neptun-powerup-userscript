// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleApi } from '../../src/types/modules'
import {
  addSaveButtonsToRows,
  getExamRows,
  getRowSubjectCode,
  getSubjectCode,
  parseExamRow,
} from '../../src/modules/exam-signup/dom'
import { setApi, setCachedSubjectCode } from '../../src/modules/exam-signup/state'

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

describe('exam-signup getSubjectCode', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/hallgatoi/exams/overview/registration')
    setApi(createMockApi())
    setCachedSubjectCode(undefined)
  })

  afterEach(() => {
    setCachedSubjectCode(undefined)
    setApi(null)
    document.body.innerHTML = ''
  })

  it('extracts a non-BME subject code from the heading area', () => {
    document.body.innerHTML = `
      <main>
        <section>
          <h1>Exam registration</h1>
          <div>Data structures ABC12DE345-01</div>
        </section>
      </main>
    `

    expect(getSubjectCode()).toBe('ABC12DE345-01')
  })

  it('falls back to the subjectName query parameter', () => {
    window.history.replaceState(
      {},
      '',
      '/hallgatoi/exams/overview/registration?subjectName=Algorithms%20ABC12DE345-01',
    )

    expect(getSubjectCode()).toBe('ABC12DE345-01')
  })

  it('does not scan the entire main content and bind to a row-like token', () => {
    document.body.innerHTML = `
      <main>
        <section>
          <h1>Exam registration</h1>
          <div>Data structures</div>
        </section>
        <table>
          <tr>
            <td>2026-05-01</td>
            <td>Written</td>
            <td>0 / 30</td>
            <td>Teacher</td>
            <td>ABC12DE345-01</td>
            <td><button class="table-action">Felvetel</button></td>
          </tr>
        </table>
      </main>
    `

    expect(getSubjectCode()).toBeNull()
  })

  it('returns null on overview pages with multiple subject tables', () => {
    document.body.innerHTML = `
      <main>
        <h1>Vizsgajelentkezes</h1>
        <h3>Adatbazisok</h3>
        <p>BMEVITMAB04</p>
        <table>
          <tr>
            <td>2026. junius 8. 8:00</td>
            <td>Irasbeli</td>
            <td>0 / 23</td>
            <td><button>Felvetel</button></td>
          </tr>
        </table>
        <p>BMEVITMAD01</p>
        <table>
          <tr>
            <td>2026. junius 9. 8:00</td>
            <td>Irasbeli</td>
            <td>0 / 20</td>
            <td><button>Felvetel</button></td>
          </tr>
        </table>
      </main>
    `

    expect(getSubjectCode()).toBeNull()
  })
})

describe('exam-signup table parsing', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setApi(createMockApi())
  })

  afterEach(() => {
    setApi(null)
    document.body.innerHTML = ''
  })

  it('detects exam rows in the compact 4-column layout', () => {
    document.body.innerHTML = `
      <table>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Capacity</th>
          <th>Action</th>
        </tr>
        <tr>
          <td>2026. junius 8. 8:00</td>
          <td>Irasbeli</td>
          <td>0 / 23</td>
          <td><button>Felvetel</button></td>
        </tr>
      </table>
    `

    const rows = getExamRows()
    expect(rows).toHaveLength(1)

    const info = parseExamRow(rows[0])
    expect(info.date).toBe('2026. junius 8. 8:00')
    expect(info.type).toBe('Irasbeli')
    expect(info.capacity).toBe('0 / 23')
    expect(info.instructor).toBe('')
    expect(info.courseCode).toBe('')
    expect(info.registrationState).toBe('available')
    expect(info.felvetelBtn?.textContent).toContain('Felvetel')
  })

  it('separates registered row status from the exam date', () => {
    document.body.innerHTML = `
      <table>
        <tr>
          <td>
            <button>2026. június 4. 13:00</button>
            <div>Felvéve</div>
          </td>
          <td>Írásbeli</td>
          <td>33 / 100</td>
          <td>Dr. Szieberth Dénes</td>
          <td>10</td>
          <td><button>Leadás</button><button>Részletek</button></td>
        </tr>
      </table>
    `

    const rows = getExamRows()
    const info = parseExamRow(rows[0])

    expect(info.date).toBe('2026. június 4. 13:00')
    expect(info.registrationState).toBe('registered')
    expect(info.felvetelBtn).toBeNull()
  })

  it('detects full and waitlist-only exam row states from visible labels', () => {
    document.body.innerHTML = `
      <table>
        <tr>
          <td>2026. június 8. 8:00<div>Csak várólistás jelentkezés.</div></td>
          <td>Írásbeli</td>
          <td>23 / 23</td>
          <td><button>Felvétel</button></td>
        </tr>
        <tr>
          <td>2026. június 8. 9:00<div>Betelt</div></td>
          <td>Szóbeli</td>
          <td>0 / 0</td>
          <td><button>Felvétel</button></td>
        </tr>
      </table>
    `

    const rows = getExamRows()

    expect(parseExamRow(rows[0]).registrationState).toBe('waitlistOnly')
    expect(parseExamRow(rows[1]).registrationState).toBe('full')
  })

  it('treats a full exam as registered when the row also says the student is enrolled', () => {
    document.body.innerHTML = `
      <table>
        <tr>
          <td>2026. június 11. 8:00<div>Betelt • Felvéve</div></td>
          <td>Írásbeli</td>
          <td>100 / 100</td>
          <td>Dr. Buttyán Levente</td>
          <td>E</td>
          <td><button>Leadás</button><button>Részletek</button></td>
        </tr>
      </table>
    `

    const rows = getExamRows()

    expect(parseExamRow(rows[0]).registrationState).toBe('registered')
  })

  it('does not treat available, full, or waitlist-only rows as registered beside another registered table', () => {
    document.body.innerHTML = `
      <main>
        <h3>A könnyűbúvárkodás - mérnöki szemmel</h3>
        <p>BMEVESAA010</p>
        <table>
          <tr>
            <td>2026. június 4. 13:00<div>Felvéve</div></td>
            <td>Írásbeli</td>
            <td>34 / 100</td>
            <td>Dr. Szieberth Dénes</td>
            <td>10</td>
            <td><button>Leadás</button><button>Részletek</button></td>
          </tr>
          <tr>
            <td>2026. június 11. 13:00</td>
            <td>Írásbeli</td>
            <td>7 / 100</td>
            <td>Dr. Szieberth Dénes</td>
            <td>10</td>
            <td><button>Felvétel</button><button>Részletek</button></td>
          </tr>
        </table>

        <h3>Adatbázisok</h3>
        <p>BMEVITMAB04</p>
        <table>
          <tr>
            <td>2026. június 8. 8:00<div>Csak várólistás jelentkezés.</div></td>
            <td>Írásbeli</td>
            <td>23 / 23</td>
            <td>Dr. Gajdos Sándor</td>
            <td>V1</td>
            <td><button>Felvétel</button><button>Részletek</button></td>
          </tr>
          <tr>
            <td>2026. június 8. 9:00<div>Betelt</div></td>
            <td>Szóbeli</td>
            <td>0 / 0</td>
            <td>Dr. Gajdos Sándor</td>
            <td>V1</td>
            <td><button>Felvétel</button><button>Részletek</button></td>
          </tr>
          <tr>
            <td>2026. június 9. 8:00</td>
            <td>Írásbeli</td>
            <td>7 / 23</td>
            <td>Dr. Gajdos Sándor</td>
            <td>V1</td>
            <td><button>Felvétel</button><button>Részletek</button></td>
          </tr>
        </table>
      </main>
    `

    const states = getExamRows().map((row) => parseExamRow(row).registrationState)

    expect(states).toEqual(['registered', 'available', 'waitlistOnly', 'full', 'available'])
  })

  it('prefers the Felvetel action button over date and details buttons', () => {
    document.body.innerHTML = `
      <table>
        <tr>
          <td><button>2026. junius 5. 10:00</button></td>
          <td>Jelentkezteto</td>
          <td>0 / 329</td>
          <td>Dr. Adamis</td>
          <td>E1</td>
          <td>
            <button>Felvetel</button>
            <button>Reszletek</button>
          </td>
        </tr>
      </table>
    `

    const rows = getExamRows()
    const info = parseExamRow(rows[0])

    expect(info.felvetelBtn?.textContent).toContain('Felvetel')
  })

  it('ignores injected save controls when parsing the exam date', () => {
    document.body.innerHTML = `
      <table>
        <tr>
          <td>
            <button>2026. junius 5. 10:00</button>
            <div class="npu-exam-save-slot">
              <button class="npu-exam-save-btn">SAVE</button>
            </div>
          </td>
          <td>Jelentkezteto</td>
          <td>0 / 329</td>
          <td>Dr. Adamis</td>
          <td>E1</td>
          <td><button>Felvetel</button></td>
        </tr>
      </table>
    `

    const rows = getExamRows()
    const info = parseExamRow(rows[0])

    expect(info.date).toBe('2026. junius 5. 10:00')
  })

  it('adds save buttons with the table-local subject code on overview pages', () => {
    document.body.innerHTML = `
      <main>
        <h3>Adatbazisok</h3>
        <p>BMEVITMAB04</p>
        <table>
          <tr>
            <td>2026. junius 8. 8:00</td>
            <td>Irasbeli</td>
            <td>0 / 23</td>
            <td><button>Felvetel</button></td>
          </tr>
        </table>
        <p>BMEVITMAD01</p>
        <table>
          <tr>
            <td>2026. junius 9. 8:00</td>
            <td>Irasbeli</td>
            <td>0 / 20</td>
            <td><button>Felvetel</button></td>
          </tr>
        </table>
      </main>
    `

    const onSave = vi.fn()
    addSaveButtonsToRows(null, onSave)

    const saveButtons = Array.from(
      document.querySelectorAll('.npu-exam-save-btn'),
    ) as HTMLButtonElement[]
    expect(saveButtons).toHaveLength(2)
    expect(document.querySelectorAll('.npu-exam-save-slot')).toHaveLength(2)
    expect(saveButtons[1].closest('td')?.textContent).toContain('2026. junius 9. 8:00')

    saveButtons[1].click()
    expect(onSave).toHaveBeenCalledWith('BMEVITMAD01', '2026. junius 9. 8:00', 'Irasbeli', '')
  })

  it('resolves subject codes when tables are preceded by standalone labels in document order', () => {
    document.body.innerHTML = `
      <main>
        <section>
          <h3>Informacios rendszerek uzemeltetese</h3>
          <p>BMEVITMAD01</p>
          <div class="table-shell">
            <table>
              <tr>
                <td>2026. junius 5. 10:00</td>
                <td>Jelentkezteto</td>
                <td>0 / 329</td>
                <td>Dr. Adamis</td>
                <td>E1</td>
                <td><button>Felvetel</button></td>
              </tr>
            </table>
          </div>
        </section>
      </main>
    `

    const onSave = vi.fn()
    addSaveButtonsToRows(null, onSave)
    const rows = getExamRows()

    const saveButtons = Array.from(
      document.querySelectorAll('.npu-exam-save-btn'),
    ) as HTMLButtonElement[]
    expect(saveButtons).toHaveLength(1)

    saveButtons[0].click()
    expect(onSave).toHaveBeenCalledWith(
      'BMEVITMAD01',
      '2026. junius 5. 10:00',
      'Jelentkezteto',
      'E1',
    )
    expect(getRowSubjectCode(rows[0])).toBe('BMEVITMAD01')
  })
})
