// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  hasNeptunFingerprint,
  hasNeptunSessionStorage,
  isLikelyNeptunPortal,
  isSupportedPortalPath,
} from '../../src/utils/neptun-detect'

describe('neptun-detect', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.title = ''
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

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

  it('detects a Neptun-like app shell with matching asset markers', () => {
    document.body.innerHTML = '<app-root ng-version="20.0.0"></app-root>'
    const script = document.createElement('script')
    script.src = '/hallgatoi/main.js'
    document.head.appendChild(script)

    expect(hasNeptunFingerprint(document)).toBe(true)
  })

  it('rejects body text as a standalone Neptun fingerprint', () => {
    document.body.innerHTML = '<main>Fake Neptun landing page</main>'

    expect(hasNeptunFingerprint(document)).toBe(false)
    expect(
      isLikelyNeptunPortal({ pathname: '/hallgatoi/login' } as Location, document, sessionStorage),
    ).toBe(false)
  })

  it('can detect a live session from storage even if the title is generic', () => {
    sessionStorage.clear()
    document.title = 'University Portal'
    sessionStorage.setItem('access_token', 'token')

    expect(hasNeptunSessionStorage(sessionStorage)).toBe(true)
    expect(
      isLikelyNeptunPortal({ pathname: '/hallgatoi/login' } as Location, document, sessionStorage),
    ).toBe(true)
  })

  it('rejects unrelated hallgato-like pages without a Neptun fingerprint', () => {
    sessionStorage.clear()
    document.title = 'University Portal'
    document.body.innerHTML = '<main>Student information page</main>'

    expect(
      isLikelyNeptunPortal({ pathname: '/hallgatoi/help' } as Location, document, sessionStorage),
    ).toBe(false)
  })
})
