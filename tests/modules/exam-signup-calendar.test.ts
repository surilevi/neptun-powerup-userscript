// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  buildRegisteredExamCalendarEntries,
  buildSavedExamCalendarEntries,
  mergeExamCalendarEntries,
  renderExamCalendar,
} from '../../src/modules/exam-signup/calendar'
import type { ExamRowInfo } from '../../src/modules/exam-signup/state'

function rowInfo(
  date: string,
  registrationState: ExamRowInfo['registrationState'],
  type = 'Írásbeli',
): ExamRowInfo {
  const row = document.createElement('tr')
  return {
    row,
    date,
    type,
    capacity: '1 / 10',
    instructor: '',
    courseCode: 'V1',
    registrationState,
    felvetelBtn: null,
  }
}

describe('exam calendar model', () => {
  it('builds saved calendar entries from stored preferences', () => {
    const entries = buildSavedExamCalendarEntries({
      BMEVITMAB04: {
        date: '2026. június 8. 8:00',
        type: 'Írásbeli',
        courseCode: 'V1',
      },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      subjectCode: 'BMEVITMAB04',
      source: 'saved',
      parsed: { day: '2026-06-08', time: '08:00' },
    })
  })

  it('builds registered entries only from registered visible rows', () => {
    const entries = buildRegisteredExamCalendarEntries([
      { subjectCode: 'BMEVESAA010', info: rowInfo('2026. június 4. 13:00', 'registered') },
      { subjectCode: 'BMEVITMAB04', info: rowInfo('2026. június 8. 8:00', 'available') },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      subjectCode: 'BMEVESAA010',
      source: 'registered',
      parsed: { day: '2026-06-04', time: '13:00' },
    })
  })

  it('prefers registered visible entries over duplicate saved entries', () => {
    const saved = buildSavedExamCalendarEntries({
      BMEVESAA010: {
        date: '2026. június 4. 13:00',
        type: 'Írásbeli',
        courseCode: '10',
      },
    })
    const registered = buildRegisteredExamCalendarEntries([
      { subjectCode: 'BMEVESAA010', info: rowInfo('2026. június 4. 13:00', 'registered') },
    ])

    const merged = mergeExamCalendarEntries(saved, registered)

    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('registered')
  })

  it('renders a compact calendar with registered and saved details', () => {
    const entries = mergeExamCalendarEntries(
      buildSavedExamCalendarEntries({
        BMEVITMAB04: {
          date: '2026. június 8. 8:00',
          type: 'Írásbeli',
          courseCode: 'V1',
        },
      }),
      buildRegisteredExamCalendarEntries([
        { subjectCode: 'BMEVESAA010', info: rowInfo('2026. június 4. 13:00', 'registered') },
      ]),
    )

    const calendar = renderExamCalendar(entries, new Date(2026, 4, 28))

    expect(calendar?.textContent).toContain('June 2026')
    expect(calendar?.textContent).toContain('Registered exams')
    expect(calendar?.textContent).toContain('BMEVESAA010')
    expect(calendar?.textContent).toContain('Registered')
  })
})
