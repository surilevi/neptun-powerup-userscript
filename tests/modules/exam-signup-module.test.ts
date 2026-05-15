import { describe, expect, it } from 'vitest'
import { examSignupModule } from '../../src/modules/exam-signup'

describe('examSignupModule.shouldActivate', () => {
  it('activates on the exam overview page', () => {
    expect(
      examSignupModule.shouldActivate({
        url: 'https://neptun.bme.hu/hallgatoi/exams/overview/registration',
        domain: 'bme.hu',
        path: '/hallgatoi/exams/overview/registration',
      }),
    ).toBe(true)
  })

  it('does not activate on exam detail pages under the overview route', () => {
    expect(
      examSignupModule.shouldActivate({
        url: 'https://neptun.bme.hu/hallgatoi/exams/overview/registration/3c04ed64-e76d-4ed9-a246-bc05416f887f',
        domain: 'bme.hu',
        path: '/hallgatoi/exams/overview/registration/3c04ed64-e76d-4ed9-a246-bc05416f887f',
      }),
    ).toBe(false)
  })
})
