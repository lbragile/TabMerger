/**
 * robots.txt with more than one public locale: the signed-in app paths are disallowed under each
 * non-default prefix too (`/es/dashboard`), English stays unprefixed. Mocks the locale list, since
 * only English ships today.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/i18n/locales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/locales')>()
  return { ...actual, PUBLIC_LOCALES: ['en', 'es', 'pt-BR'] }
})

import { disallowedPaths } from '@/app/robots'

describe('robots disallow list with several locales', () => {
  it('lists /dashboard and /account for English and under each other locale prefix, then the API', () => {
    expect(disallowedPaths()).toEqual([
      '/dashboard',
      '/account',
      '/es/dashboard',
      '/es/account',
      '/pt-BR/dashboard',
      '/pt-BR/account',
      '/api/',
    ])
  })
})
