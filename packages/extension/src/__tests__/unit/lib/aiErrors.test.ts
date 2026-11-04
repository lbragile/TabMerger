import { describe, it, expect, afterEach } from 'vitest'
import { AI_ERROR_CODES } from '@tabmerger/shared'
import { AiRequestError, aiErrorMessage, formatRetryAfter, isFixedInAiSettings, retryAfterSecondsOf } from '@/lib/aiErrors'
import { i18n, t } from '@/lib/i18n'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('rate_limited messages', () => {
  it('has its own message, not the out-of-credits one', () => {
    expect(aiErrorMessage(AI_ERROR_CODES.rateLimited)).toBe('Too many AI requests right now. Try again in a minute.')
    expect(aiErrorMessage(AI_ERROR_CODES.rateLimited)).not.toBe(t('common.aiQuotaUsed'))
  })

  it('names the wait when the server sent one', () => {
    expect(aiErrorMessage(AI_ERROR_CODES.rateLimited, { retryAfterSeconds: 2 })).toBe(
      'Too many AI requests right now. Try again in 2 seconds.'
    )
  })

  it('ignores a wait on any other code', () => {
    expect(aiErrorMessage(AI_ERROR_CODES.overloaded, { retryAfterSeconds: 2 })).toBe(t('errors.ai.overloaded'))
  })

  it('says the wait in the active language', async () => {
    await i18n.changeLanguage('de')
    expect(aiErrorMessage(AI_ERROR_CODES.rateLimited, { retryAfterSeconds: 30 })).toBe(
      'Gerade zu viele KI-Anfragen. Versuche es in 30 Sekunden erneut.'
    )
  })

  it('is not fixed in Settings', () => {
    expect(isFixedInAiSettings(new AiRequestError(AI_ERROR_CODES.rateLimited, 429, 'x', 5))).toBe(false)
  })
})

describe('formatRetryAfter', () => {
  it('uses seconds under a minute, minutes under an hour, else hours, rounded up', () => {
    expect(formatRetryAfter(1)).toBe('in 1 second')
    expect(formatRetryAfter(59)).toBe('in 59 seconds')
    expect(formatRetryAfter(60)).toBe('in 1 minute')
    expect(formatRetryAfter(61)).toBe('in 2 minutes')
    expect(formatRetryAfter(3599)).toBe('in 60 minutes')
    expect(formatRetryAfter(3600)).toBe('in 1 hour')
    expect(formatRetryAfter(86_400)).toBe('in 24 hours')
  })
})

describe('retryAfterSecondsOf', () => {
  it('reads a positive number or numeric string, rounded up to whole seconds', () => {
    expect(retryAfterSecondsOf(30)).toBe(30)
    expect(retryAfterSecondsOf(1.2)).toBe(2)
    expect(retryAfterSecondsOf(0.3)).toBe(1)
    expect(retryAfterSecondsOf('120')).toBe(120)
  })

  it('is undefined for anything else', () => {
    for (const value of [undefined, null, 0, -5, Number.NaN, Infinity, '', '  ', 'soon', {}]) {
      expect(retryAfterSecondsOf(value)).toBeUndefined()
    }
  })
})
