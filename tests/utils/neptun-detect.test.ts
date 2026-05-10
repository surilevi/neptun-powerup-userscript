// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hasNeptunFingerprint, hasNeptunSessionStorage, isLikelyNeptunPortal, isSupportedPortalPath } from '../../src/utils/neptun-detect'

describe('neptun-detect', () => {
  it('accepts the supported Neptun path families only', () => {
    expect(isSupportedPortalPath('/hallgatoi/login')).toBe(true)
    expect(isSupportedPortalPath('/hallgato_ng/login')).toBe(true)
    expect(isSupportedPortalPath('/hallgatoing/login')).toBe(true)
    expect(isSupportedPortalPath('/ujhallgato/login')).toBe(true)
    expect(isSupportedPortalPath('/hallgato-portal/login')).toBe(false)
    expect(isSupportedPortalPath('/student/login')).toBe(false)
  })

  it('detects Neptun by title and markup', () => {
    document.title = 'Neptun Web'
    document.body.innerHTML = '<main>Betoltes folyamatban</main>'

    expect(hasNeptunFingerprint(document)).toBe(true)
  })

  it('can detect a live session from storage even if the title is generic', () => {
    sessionStorage.clear()
    document.title = 'University Portal'
    sessionStorage.setItem('access_token', 'token')

    expect(hasNeptunSessionStorage(sessionStorage)).toBe(true)
    expect(isLikelyNeptunPortal({ pathname: '/hallgatoi/login' } as Location, document, sessionStorage)).toBe(true)
  })

  it('rejects unrelated hallgato-like pages without a Neptun fingerprint', () => {
    sessionStorage.clear()
    document.title = 'University Portal'
    document.body.innerHTML = '<main>Student information page</main>'

    expect(isLikelyNeptunPortal({ pathname: '/hallgatoi/help' } as Location, document, sessionStorage)).toBe(false)
  })
})
