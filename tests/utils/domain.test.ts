import { describe, it, expect } from 'vitest'
import { extractDomain } from '../../src/utils/domain'

describe('extractDomain', () => {
  it('should extract domain from MATE URL', () => {
    expect(extractDomain('https://hallgato.uni-mate.hu/hallgato_ng/login')).toBe('uni-mate.hu')
  })

  it('should extract domain from Debrecen URL', () => {
    expect(extractDomain('https://www-h-ng.neptun.unideb.hu/hallgato_ng/')).toBe('unideb.hu')
  })

  it('should extract domain from Obuda URL', () => {
    expect(extractDomain('https://neptun.uni-obuda.hu/ujhallgato/login')).toBe('uni-obuda.hu')
  })

  it('should extract domain from PTE URL with server number', () => {
    expect(extractDomain('https://neptun-web2.tr.pte.hu/hallgatoing/login')).toBe('pte.hu')
  })

  it('should extract domain from Corvinus URL', () => {
    expect(extractDomain('https://neptun3r.web.uni-corvinus.hu/hallgatoi/')).toBe('uni-corvinus.hu')
  })

  it('should extract domain from SZE URL', () => {
    expect(extractDomain('https://neptun-hweb.sze.hu/')).toBe('sze.hu')
  })

  it('should extract domain from NKE URL', () => {
    expect(extractDomain('https://neptunweb.uni-nke.hu/hallgato_ng/login')).toBe('uni-nke.hu')
  })
})
