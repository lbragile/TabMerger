import { describe, it, expect } from 'vitest'
import {
  censorProfanity,
  displayAuthor,
  isUsableRating,
  selectStoreReviews,
  STORE_STATS_REVALIDATE_SECONDS,
  type ReviewCandidate,
} from '@/lib/storeReviews'

const LONG = 'This extension keeps my tabs tidy every day.'

function cand(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    quote: LONG,
    author: 'Sample Person',
    date: '2026-03-01T00:00:00.000Z',
    score: 5,
    url: 'https://example.com/r/1',
    store: 'chrome',
    ...over,
  }
}

describe('selectStoreReviews', () => {
  it('keeps 4 and 5 star reviews and excludes everything below', () => {
    const out = selectStoreReviews([1, 2, 3, 4, 5].map((score) => cand({ score, url: `u${score}` })))
    expect(out.map((r) => r.score)).toEqual([5, 4])
  })

  it('excludes scores that are not whole stars or are out of range', () => {
    const out = selectStoreReviews([cand({ score: 4.5 }), cand({ score: 6 }), cand({ score: NaN }), cand({ score: 0 })])
    expect(out).toEqual([])
  })

  it('applies the minimum length to the trimmed text (19 out, 20 in)', () => {
    expect(selectStoreReviews([cand({ quote: 'a'.repeat(19) })])).toEqual([])
    expect(selectStoreReviews([cand({ quote: `   ${'a'.repeat(19)}   ` })])).toEqual([])
    expect(selectStoreReviews([cand({ quote: 'a'.repeat(20) })])).toHaveLength(1)
  })

  it('excludes null, undefined and empty text', () => {
    expect(selectStoreReviews([cand({ quote: null }), cand({ quote: undefined }), cand({ quote: '' })])).toEqual([])
  })

  it('orders 5 stars first, then newest within a score', () => {
    const out = selectStoreReviews([
      cand({ score: 4, date: '2026-05-01T00:00:00.000Z', url: 'a' }),
      cand({ score: 5, date: '2026-01-01T00:00:00.000Z', url: 'b' }),
      cand({ score: 5, date: '2026-02-01T00:00:00.000Z', url: 'c' }),
    ])
    expect(out.map((r) => r.url)).toEqual(['c', 'b', 'a'])
  })

  it('keeps at most 12 reviews per store, the best ones', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      cand({ score: i < 3 ? 4 : 5, date: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, url: `u${i}` }),
    )
    const out = selectStoreReviews(many)
    expect(out).toHaveLength(12)
    expect(out.every((r) => r.score === 5)).toBe(true)
  })

  it('shows the text verbatim (trimmed only) and carries url, date and store through', () => {
    const [r] = selectStoreReviews([cand({ quote: `  ${LONG}  `, store: 'edge', url: 'https://example.com/e' })])
    expect(r).toMatchObject({ quote: LONG, store: 'edge', url: 'https://example.com/e', date: '2026-03-01T00:00:00.000Z' })
  })

  it('censors profanity in the text but keeps the review', () => {
    const [r] = selectStoreReviews([cand({ quote: 'This is a fucking great extension for tabs.' })])
    expect(r.quote).not.toMatch(/fucking/i)
    expect(r.quote).toMatch(/^This is a f\*+ing great extension/)
  })

  it('does not mutate the input array', () => {
    const input = [cand({ score: 4 }), cand({ score: 5 })]
    selectStoreReviews(input)
    expect(input.map((c) => c.score)).toEqual([4, 5])
  })

  it('returns [] for no candidates', () => {
    expect(selectStoreReviews([])).toEqual([])
  })
})

describe('displayAuthor', () => {
  it.each([undefined, '', '   ', 'Firefox user 13445065', 'firefox user', 'A Google user', ' a google user '])(
    'shows %j as Anonymous reviewer',
    (name) => {
      expect(displayAuthor(name)).toBe('Anonymous reviewer')
    },
  )

  it('keeps a real display name, trimmed', () => {
    expect(displayAuthor('  Sample Person ')).toBe('Sample Person')
  })

  it('does not treat names that merely start with the placeholder as anonymous', () => {
    expect(displayAuthor('Firefox user Sam')).toBe('Firefox user Sam')
  })

  it('censors profanity in a name', () => {
    expect(displayAuthor('shitlord')).not.toMatch(/shit/i)
  })
})

describe('censorProfanity', () => {
  it('leaves clean text and innocent look-alikes untouched', () => {
    expect(censorProfanity('Great tab manager')).toBe('Great tab manager')
    expect(censorProfanity('Greetings from Scunthorpe')).toBe('Greetings from Scunthorpe')
    expect(censorProfanity('')).toBe('')
  })

  it('keeps the first letter and masks the rest, same length', () => {
    const out = censorProfanity('what the fuck')
    expect(out.startsWith('what the f')).toBe(true)
    expect(out).toHaveLength('what the fuck'.length)
    expect(out.endsWith('***')).toBe(true)
  })
})

describe('isUsableRating', () => {
  it.each([
    [4.6, 10, true],
    [5, 1, true],
    [0.1, 1, true],
    [0, 10, false],
    [-1, 10, false],
    [5.01, 10, false],
    [4.5, 0, false],
    [4.5, 1.5, false],
    [4.5, -3, false],
    [NaN, 5, false],
    [Infinity, 5, false],
    ['4.5', 5, false],
    [4.5, '5', false],
    [undefined, undefined, false],
    [null, 3, false],
  ])('isUsableRating(%j, %j) is %s', (rating, count, expected) => {
    expect(isUsableRating(rating, count)).toBe(expected)
  })
})

it('caches store figures for six hours', () => {
  expect(STORE_STATS_REVALIDATE_SECONDS).toBe(6 * 60 * 60)
})
