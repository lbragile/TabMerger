/**
 * Unit tests for lib/ai-validation.ts — the request-body schemas shared by the
 * `/api/ai/*` routes. Route-level behaviour (status codes, no usage spent on a
 * rejected body) is covered in ai-routes.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  AI_MAX_DEV_USAGE_COUNT,
  AI_MAX_GROUP_NAME_LENGTH,
  AI_MAX_TABS_PER_LIST,
  AI_MAX_TITLE_LENGTH,
  parseDescribeGroupBody,
  parseDevUsageBody,
  parseGroupTabsBody,
  parseNameGroupBody,
  parseOrganizeBody,
  parseSuggestSessionsBody,
  parseTabSummaryBody,
  readJsonBody,
  sanitizePromptText,
} from '@/lib/ai-validation'

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)
const NUL = String.fromCharCode(0)
const C1_CONTROL = String.fromCharCode(0x85)

describe('sanitizePromptText', () => {
  it('leaves ordinary text, including non-Latin text and emoji, unchanged', () => {
    expect(sanitizePromptText('Docs — 日本語 🎉 café', 100)).toBe('Docs — 日本語 🎉 café')
  })

  it('turns each run of control characters and line breaks into one space, and trims', () => {
    const raw = `  a\r\n\n\tb${NUL}c${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}d${C1_CONTROL}e  `
    expect(sanitizePromptText(raw, 100)).toBe('a b c d e')
  })

  it('cuts to the limit', () => {
    expect(sanitizePromptText('x'.repeat(50), 10)).toBe('x'.repeat(10))
  })

  it('does not leave half of a surrogate pair at the cut', () => {
    const cut = sanitizePromptText(`${'x'.repeat(9)}🎉tail`, 10)
    expect(cut).toBe('x'.repeat(9))
  })

  it('keeps a whole surrogate pair that ends exactly at the limit', () => {
    expect(sanitizePromptText(`${'x'.repeat(8)}🎉tail`, 10)).toBe(`${'x'.repeat(8)}🎉`)
  })

  it('returns an empty string for text made only of control characters', () => {
    expect(sanitizePromptText('\n\r\t', 10)).toBe('')
  })
})

describe('readJsonBody', () => {
  const request = (body: string) => new Request('http://localhost/x', { method: 'POST', body })

  it('returns the parsed value for valid JSON of any type', async () => {
    expect(await readJsonBody(request('{"a":1}'))).toEqual({ a: 1 })
    expect(await readJsonBody(request('null'))).toBeNull()
    expect(await readJsonBody(request('[1]'))).toEqual([1])
  })

  it('returns undefined for an empty or malformed body', async () => {
    expect(await readJsonBody(request(''))).toBeUndefined()
    expect(await readJsonBody(request('{"a":'))).toBeUndefined()
  })
})

describe('route parsers', () => {
  const tab = { id: 3, title: 'Docs', url: 'https://example.com', favIconUrl: 'x' }

  it('group-tabs keeps id, title and url only', () => {
    expect(parseGroupTabsBody({ tabs: [tab] })).toStrictEqual({
      ok: true,
      data: [{ title: 'Docs', url: 'https://example.com', id: 3 }],
    })
  })

  it('group-tabs accepts the id 0 that saved tabs carry and an empty url', () => {
    expect(parseGroupTabsBody({ tabs: [{ id: 0, title: 'Untitled', url: '' }] }).ok).toBe(true)
  })

  it('name-group keeps title and url only', () => {
    expect(parseNameGroupBody({ tabs: [tab] })).toStrictEqual({
      ok: true,
      data: [{ title: 'Docs', url: 'https://example.com' }],
    })
  })

  it('describe-group keeps the group name and each tab\'s title and url only', () => {
    expect(parseDescribeGroupBody({ groupName: 'Work', tabs: [tab], groupId: 'g1', note: 'n', model: 'auto' })).toStrictEqual({
      ok: true,
      data: { groupName: 'Work', tabs: [{ title: 'Docs', url: 'https://example.com' }] },
    })
  })

  it('describe-group accepts an unnamed group', () => {
    expect(parseDescribeGroupBody({ groupName: '', tabs: [tab] })).toMatchObject({ ok: true, data: { groupName: '' } })
  })

  it('describe-group cleans and cuts the group name like other group names', () => {
    const nl = String.fromCharCode(10)
    const result = parseDescribeGroupBody({ groupName: `  Work${nl}<b>${'N'.repeat(200)}`, tabs: [tab] })
    expect(result.ok).toBe(true)
    const name = result.ok ? result.data.groupName : ''
    expect(name.length).toBe(AI_MAX_GROUP_NAME_LENGTH)
    expect(name.startsWith(`Work ${String.fromCharCode(0x2039)}b${String.fromCharCode(0x203a)}`)).toBe(true)
  })

  it('describe-group cleans titles and URLs like name-group', () => {
    const result = parseDescribeGroupBody({
      groupName: 'Work',
      // Credentials in the URL (joined so the secret scanner doesn't read it as an email address).
      tabs: [{ title: 'T'.repeat(AI_MAX_TITLE_LENGTH + 20), url: ['https://user:pw', 'example.com/a?token=s#frag'].join('@') }],
    })
    expect(result).toStrictEqual({
      ok: true,
      data: { groupName: 'Work', tabs: [{ title: 'T'.repeat(AI_MAX_TITLE_LENGTH), url: 'https://example.com/a' }] },
    })
  })

  it.each([
    ['no body', undefined],
    ['an array', []],
    ['a missing group name', { tabs: [{ title: 'a', url: 'https://a.example' }] }],
    ['a non-string group name', { groupName: 7, tabs: [{ title: 'a', url: 'https://a.example' }] }],
    ['no tabs', { groupName: 'x' }],
    ['an empty tab list', { groupName: 'x', tabs: [] }],
    ['a tab without a title', { groupName: 'x', tabs: [{ url: 'https://a.example' }] }],
    ['a tab with a non-string url', { groupName: 'x', tabs: [{ title: 'a', url: 1 }] }],
  ])('describe-group rejects %s', (_label, body) => {
    expect(parseDescribeGroupBody(body)).toStrictEqual({ ok: false, error: 'groupName string and tabs array required' })
  })

  it('describe-group accepts the tab ceiling and rejects one more', () => {
    const tabs = (n: number) => Array.from({ length: n }, () => ({ title: 't', url: 'https://e.com' }))
    expect(parseDescribeGroupBody({ groupName: 'x', tabs: tabs(AI_MAX_TABS_PER_LIST) }).ok).toBe(true)
    expect(parseDescribeGroupBody({ groupName: 'x', tabs: tabs(AI_MAX_TABS_PER_LIST + 1) })).toStrictEqual({
      ok: false,
      error: 'too many tabs',
    })
  })

  it('tab-summary gives the same result for both accepted shapes', () => {
    const expected = { ok: true, data: { title: 'Docs', url: 'https://example.com' } }
    expect(parseTabSummaryBody({ tab })).toStrictEqual(expected)
    expect(parseTabSummaryBody({ title: 'Docs', url: 'https://example.com' })).toStrictEqual(expected)
  })

  it('suggest-sessions accepts a group with no tabs', () => {
    expect(parseSuggestSessionsBody({ groups: [{ id: 'g1', name: 'Empty', tabs: [] }] })).toStrictEqual({
      ok: true,
      data: [{ id: 'g1', name: 'Empty', tabs: [] }],
    })
  })

  it('organize returns null data when no groups are supplied', () => {
    for (const body of [undefined, null, {}, { groups: [] }, { groups: null }, 'text', [1]]) {
      expect(parseOrganizeBody(body)).toStrictEqual({ ok: true, data: null })
    }
  })

  it('organize rejects groups that are present but structurally invalid, and never returns null for them', () => {
    expect(parseOrganizeBody({ groups: 'x' })).toStrictEqual({ ok: false, error: 'groups must be an array' })
    for (const groups of [[null], [{ id: 'g1', name: 'x' }], [{ id: '', name: 'x', tabs: [] }], [{ id: 1, name: 'x', tabs: [] }]]) {
      expect(parseOrganizeBody({ groups })).toStrictEqual({ ok: false, error: 'invalid groups' })
    }
  })

  it('organize and suggest-sessions leave out emptied groups, keep `tabs: []` groups, and reject when none remain', () => {
    const emptied = { id: 'g1', name: 'Unreadable', tabs: [null, { title: 'no url' }] }
    const empty = { id: 'g2', name: 'Empty', tabs: [] }
    const data = [{ id: 'g2', name: 'Empty', tabs: [] }]
    // organize adds `permanent`, resolved from the sent position: the kept group was second.
    expect(parseOrganizeBody({ groups: [emptied, empty] })).toStrictEqual({
      ok: true,
      data: [{ ...data[0], permanent: false }],
    })
    expect(parseSuggestSessionsBody({ groups: [emptied, empty] })).toStrictEqual({ ok: true, data })

    const rejected = { ok: false, error: 'no readable tabs in groups' }
    expect(parseOrganizeBody({ groups: [emptied] })).toStrictEqual(rejected)
    expect(parseSuggestSessionsBody({ groups: [emptied] })).toStrictEqual(rejected)
  })

  it('organize and suggest-sessions keep a group when one of its tabs is unusual', () => {
    const groups = [{ id: 'g1', name: 'Work', tabs: [{ title: null, url: 'https://u.example/a' }, { title: 'no url' }, null] }]
    const data = [{ id: 'g1', name: 'Work', tabs: [{ title: '', url: 'https://u.example/a' }] }]
    expect(parseOrganizeBody({ groups })).toStrictEqual({ ok: true, data: [{ ...data[0], permanent: true }] })
    expect(parseSuggestSessionsBody({ groups })).toStrictEqual({ ok: true, data })
  })

  it('organize truncates a long title inside a group', () => {
    const result = parseOrganizeBody({
      groups: [{ id: 'g1', name: 'Work', tabs: [{ title: 'x'.repeat(AI_MAX_TITLE_LENGTH + 1), url: 'https://u.example/a' }] }],
    })
    expect(result).toStrictEqual({
      ok: true,
      data: [
        { id: 'g1', name: 'Work', tabs: [{ title: 'x'.repeat(AI_MAX_TITLE_LENGTH), url: 'https://u.example/a' }], permanent: true },
      ],
    })
  })

  it('dev-usage accepts integers from 0 to the ceiling only', () => {
    expect(parseDevUsageBody({ count: 0 })).toStrictEqual({ ok: true, data: 0 })
    expect(parseDevUsageBody({ count: AI_MAX_DEV_USAGE_COUNT }).ok).toBe(true)
    for (const body of [null, [], {}, { count: -1 }, { count: 1.5 }, { count: '3' }, { count: AI_MAX_DEV_USAGE_COUNT + 1 }]) {
      expect(parseDevUsageBody(body)).toStrictEqual({ ok: false, error: 'count must be a non-negative integer' })
    }
  })
})
