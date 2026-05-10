import { describe, expect, it } from 'vitest'
import { extractSubjectCodeFromText, isLikelySubjectCode } from '../../src/utils/subject-code'

describe('subject-code utilities', () => {
  it('accepts subject-like identifiers from multiple university styles', () => {
    expect(isLikelySubjectCode('BMEGT60LNGN101-01')).toBe(true)
    expect(isLikelySubjectCode('ABC12DE345-01')).toBe(true)
    expect(isLikelySubjectCode('IK2024AB12')).toBe(true)
  })

  it('rejects course-like identifiers and plain words', () => {
    expect(isLikelySubjectCode('2XX_A1N')).toBe(false)
    expect(isLikelySubjectCode('NE1')).toBe(false)
    expect(isLikelySubjectCode('JELENLETI')).toBe(false)
  })

  it('extracts the best subject-code candidate from mixed header text', () => {
    const text = 'Mobil es webes szoftverek 5 kredit Evkozi jegy ABC12DE345-01'
    expect(extractSubjectCodeFromText(text)).toBe('ABC12DE345-01')
  })

  it('prefers the full subject code over shorter course-like tokens', () => {
    const text = 'BMEGT60LNGN101-01 2XX_A1N Jelenleti'
    expect(extractSubjectCodeFromText(text)).toBe('BMEGT60LNGN101-01')
  })
})
