// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { decideRushRedirect, isOnLoginPage, isOnRushPage } from '../../src/core/rush-navigation'

/**
 * Reported failure: logged out, armed Course Rush, logged in — the rush never
 * reached the registration page. The old redirect only fired on an SPA route
 * change away from `/login`, which a credential login ending in a full page load
 * never produces. These cases pin the state-based decision that replaced it.
 */
describe('rush redirect decision', () => {
  it('waits while the user is still on the login page', () => {
    expect(decideRushRedirect('course', '/hallgatoi/login', false, 0)).toEqual({
      action: 'wait-for-login',
    })
  })

  it('waits when authenticated flag is not set yet', () => {
    expect(decideRushRedirect('course', '/hallgatoi/main', false, 0)).toEqual({
      action: 'wait-for-login',
    })
  })

  it('navigates from any authenticated page that is not the rush page', () => {
    expect(decideRushRedirect('course', '/hallgatoi/main', true, 0)).toEqual({
      action: 'navigate',
      url: `${window.location.origin}/hallgatoi/subjects/registration`,
    })
  })

  it('does nothing once already on the rush page', () => {
    expect(decideRushRedirect('course', '/hallgatoi/subjects/registration', true, 0)).toEqual({
      action: 'already-there',
    })
  })

  it('stops after the redirect budget is spent so Neptun cannot ping-pong us', () => {
    expect(decideRushRedirect('course', '/hallgatoi/main', true, 2)).toEqual({
      action: 'budget-exhausted',
    })
  })

  it('routes exam rush to the exam overview', () => {
    expect(decideRushRedirect('exam', '/hallgatoi/main', true, 0)).toEqual({
      action: 'navigate',
      url: `${window.location.origin}/hallgatoi/exams/overview/registration`,
    })
  })

  it('recognises the portal paths', () => {
    expect(isOnLoginPage('/hallgatoi/login')).toBe(true)
    expect(isOnRushPage('course', '/hallgatoi/subjects/registration')).toBe(true)
    expect(isOnRushPage('exam', '/hallgatoi/subjects/registration')).toBe(false)
  })
})
