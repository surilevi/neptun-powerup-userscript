import { describe, it, expect } from 'vitest'
import { extractPath, isAuthEndpoint } from '../../src/utils/page'

describe('extractPath', () => {
  it('should extract path from full URL', () => {
    expect(extractPath('https://example.hu/hallgato_ng/login')).toBe('/hallgato_ng/login')
  })

  it('should handle paths with query strings', () => {
    expect(extractPath('https://example.hu/hallgato_ng/courses?term=2')).toBe(
      '/hallgato_ng/courses',
    )
  })

  it('should handle root path', () => {
    expect(extractPath('https://example.hu/')).toBe('/')
  })
})

describe('isAuthEndpoint', () => {
  it('should match authenticate endpoint', () => {
    expect(isAuthEndpoint('https://example.hu/hallgatoing/api/Account/Authenticate')).toBe(true)
  })

  it('should match refresh token endpoint', () => {
    expect(isAuthEndpoint('https://example.hu/hallgato_ng/api/Account/GetNewTokens')).toBe(true)
  })

  it('should not match non-auth endpoints', () => {
    expect(isAuthEndpoint('https://example.hu/hallgato_ng/api/Courses/List')).toBe(false)
  })

  it('should be case-insensitive', () => {
    expect(isAuthEndpoint('https://example.hu/api/account/authenticate')).toBe(true)
  })
})
