import { describe, it, expect } from 'vitest'
import { AI_NAME_GROUP_SUGGESTIONS } from '@tabmerger/shared'
import { MAX_AI_GROUP_NAME_LENGTH, cleanSuggestedName, isSameGroupName, suggestedGroupNames } from '@/lib/aiGroupName'
import { typedGroupName } from '@/lib/groupName'

/**
 * AI group-name replies are provider output: each suggestion is cleaned, unusable ones and repeats
 * dropped, and an older server's `name`-only reply still works. A typed name is checked like the
 * sidebar's inline rename.
 */

describe('cleanSuggestedName', () => {
  it('collapses whitespace runs, trims and caps', () => {
    expect(cleanSuggestedName('  a\n\tb  ')).toBe('a b')
    expect(cleanSuggestedName('x'.repeat(MAX_AI_GROUP_NAME_LENGTH + 5))).toHaveLength(MAX_AI_GROUP_NAME_LENGTH)
  })

  it.each([[''], ['   '], [42], [null], [undefined], [{}]])('%j is unusable', (raw) => {
    expect(cleanSuggestedName(raw)).toBeNull()
  })
})

describe('isSameGroupName', () => {
  it('ignores case only', () => {
    expect(isSameGroupName('News', 'news')).toBe(true)
    expect(isSameGroupName('News', 'News ')).toBe(false)
  })
})

describe('suggestedGroupNames', () => {
  it('takes `names` in order', () => {
    expect(suggestedGroupNames({ names: ['A', 'B', 'C'], name: 'A' })).toEqual(['A', 'B', 'C'])
  })

  it(`keeps at most ${AI_NAME_GROUP_SUGGESTIONS}`, () => {
    expect(suggestedGroupNames({ names: ['A', 'B', 'C', 'D', 'E'], name: 'A' })).toHaveLength(AI_NAME_GROUP_SUGGESTIONS)
  })

  it('cleans each, drops unusable entries and repeats ignoring case, keeping the first spelling', () => {
    expect(suggestedGroupNames({ names: [' Local\nNews ', null, '', 'local news', 'LOCAL NEWS', 'Votes'], name: 'Local News' })).toEqual(['Local News', 'Votes'])
  })

  it('counts the cap after dropping, so a repeat does not cost a slot', () => {
    expect(suggestedGroupNames({ names: ['A', 'a', 'B', 'b', 'C'] })).toEqual(['A', 'B', 'C'])
  })

  it.each([
    ['only `name` (an older server)', { name: 'Solo' }],
    ['`names` empty', { names: [], name: 'Solo' }],
    ['`names` not an array', { names: 'X', name: 'Solo' }],
  ])('falls back to `name` with %s', (_label, reply) => {
    expect(suggestedGroupNames(reply)).toEqual(['Solo'])
  })

  it('reads the list from `name` when a stale server sends it there without `names`', () => {
    expect(suggestedGroupNames({ name: ['Elections Future', 'Elections Research', 'Reading List'] })).toEqual([
      'Elections Future',
      'Elections Research',
      'Reading List',
    ])
  })

  it('a `name` array is cleaned, deduped and capped like `names`', () => {
    expect(suggestedGroupNames({ names: [], name: [' A ', 'a', null, 'B', 'C', 'D'] })).toEqual(['A', 'B', 'C'])
  })

  it('prefers a non-empty `names` over a `name` array', () => {
    expect(suggestedGroupNames({ names: ['X'], name: ['Y', 'Z'] })).toEqual(['X'])
  })

  it('an empty `name` array gives nothing', () => {
    expect(suggestedGroupNames({ name: [] })).toEqual([])
  })

  it('a `names` array of only unusable entries gives nothing (no fallback to `name`)', () => {
    expect(suggestedGroupNames({ names: ['', 7], name: 'Solo' })).toEqual([])
  })

  it.each([[null], [undefined], ['Solo'], [42], [{}], [{ name: '  ' }]])('%j gives nothing', (reply) => {
    expect(suggestedGroupNames(reply)).toEqual([])
  })
})

describe('typedGroupName', () => {
  it('trims, and an empty or blank name is null', () => {
    expect(typedGroupName('  My tabs  ')).toBe('My tabs')
    expect(typedGroupName('')).toBeNull()
    expect(typedGroupName(' \t ')).toBeNull()
  })

  it('keeps inner spacing as typed (like the inline rename)', () => {
    expect(typedGroupName('a  b')).toBe('a  b')
  })
})
