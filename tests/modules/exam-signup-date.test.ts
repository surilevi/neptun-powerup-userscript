import { describe, expect, it } from 'vitest'
import { extractExamDateText, parseExamDateText } from '../../src/modules/exam-signup/date'

describe('exam-signup date parsing', () => {
  it('parses Hungarian month names with accents', () => {
    expect(parseExamDateText('2026. június 4. 13:00')).toEqual({
      raw: '2026. június 4. 13:00',
      day: '2026-06-04',
      time: '13:00',
      year: 2026,
      month: 6,
      dayOfMonth: 4,
    })
  })

  it('parses Hungarian month names without accents', () => {
    expect(parseExamDateText('2026. junius 8. 8:00')).toMatchObject({
      raw: '2026. junius 8. 8:00',
      day: '2026-06-08',
      time: '08:00',
    })
  })

  it('parses numeric Neptun dates', () => {
    expect(parseExamDateText('2026.06.01. 08:00')).toMatchObject({
      raw: '2026.06.01. 08:00',
      day: '2026-06-01',
      time: '08:00',
    })
  })

  it('extracts the date from a date cell that also contains registration status', () => {
    expect(extractExamDateText('2026. június 4. 13:00 Felvéve')).toBe('2026. június 4. 13:00')
  })

  it('returns null for unrecognized dates', () => {
    expect(parseExamDateText('Vizsgaidopont kesobb')).toBeNull()
  })
})
