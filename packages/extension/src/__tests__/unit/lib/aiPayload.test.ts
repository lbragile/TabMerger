import { describe, it, expect } from 'vitest'
import { AI_MAX_GROUP_NAME_LENGTH, AI_MAX_TITLE_LENGTH, AI_MAX_URL_LENGTH } from '@tabmerger/shared'
import { aiGroupListTab, aiIdentifiedTab, aiPromptGroupName, aiPromptTab, cutText, cutUrl } from '@/lib/aiPayload'

describe('cutText', () => {
  it('keeps text within the limit as is and cuts longer text to it', () => {
    expect(cutText('abc', 3)).toBe('abc')
    expect(cutText('abcdef', 3)).toBe('abc')
  })

  it('is empty for anything but a string', () => {
    expect(cutText(undefined, 5)).toBe('')
    expect(cutText(42, 5)).toBe('')
    expect(cutText(null, 5)).toBe('')
  })

  it('never leaves half of a surrogate pair at the end', () => {
    // '😀' is two UTF-16 units; a cut after its first half drops that half
    expect(cutText('ab😀c', 3)).toBe('ab')
    expect(cutText('ab😀c', 4)).toBe('ab😀')
  })
})

describe('cutUrl', () => {
  const base = 'https://example.com/'

  it('sends a URL within the limit untouched, fragment and all', () => {
    expect(cutUrl(`${base}a?x=1#frag`)).toBe(`${base}a?x=1#frag`)
  })

  it('is empty for anything but a string', () => {
    expect(cutUrl(undefined)).toBe('')
  })

  it('drops the fragment first, so the cut keeps more of the path', () => {
    const path = 'p'.repeat(AI_MAX_URL_LENGTH - base.length)
    expect(cutUrl(`${base}${path}#${'f'.repeat(2000)}`)).toBe(`${base}${path}`)
  })

  it('cuts a long path to the limit', () => {
    const url = `${base}${'p'.repeat(2000)}`
    expect(cutUrl(url)).toBe(url.slice(0, AI_MAX_URL_LENGTH))
  })

  it('drops a query parameter the cut lands inside, so half a token is never sent', () => {
    const head = `${base}search?q=cats&page=2`
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${'x'.repeat(1000)}.sig`
    expect(cutUrl(`${head}&t=${jwt}`)).toBe(head)
  })

  it('drops the whole query when the cut lands in its first parameter', () => {
    expect(cutUrl(`${base}page?data=${'x'.repeat(2000)}`)).toBe(`${base}page`)
  })

  it('reduces a huge data: URL to its first characters', () => {
    const url = `data:image/png;base64,${'A'.repeat(100_000)}`
    expect(cutUrl(url)).toHaveLength(AI_MAX_URL_LENGTH)
    expect(cutUrl(url).startsWith('data:image/png')).toBe(true)
  })

  it('takes another limit', () => {
    expect(cutUrl(`${base}abcdef`, base.length + 2)).toBe(`${base}ab`)
  })
})

describe('tab and group payloads', () => {
  const tab = {
    id: 9,
    title: 'T'.repeat(AI_MAX_TITLE_LENGTH + 10),
    url: `https://example.com/${'u'.repeat(AI_MAX_URL_LENGTH)}`,
    favIconUrl: 'data:image/png;base64,AAAA',
    pinned: true
  }

  it('aiPromptTab keeps only the title and URL, cut to the server lengths', () => {
    const sent = aiPromptTab(tab)
    expect(Object.keys(sent).sort()).toEqual(['title', 'url'])
    expect(sent.title).toHaveLength(AI_MAX_TITLE_LENGTH)
    expect(sent.url).toHaveLength(AI_MAX_URL_LENGTH)
  })

  it('aiPromptTab sends an empty title and URL for missing ones (the strict routes need strings)', () => {
    expect(aiPromptTab({})).toEqual({ title: '', url: '' })
  })

  it('aiIdentifiedTab adds the tab id', () => {
    expect(aiIdentifiedTab(tab)).toEqual({ id: 9, ...aiPromptTab(tab) })
  })

  it('aiGroupListTab leaves out a missing URL so the tolerant routes drop the tab as before', () => {
    expect(aiGroupListTab({ title: 'No URL' })).toEqual({ title: 'No URL' })
    expect(aiGroupListTab(tab)).toEqual(aiPromptTab(tab))
  })

  it('aiPromptGroupName cuts a group name to the server length', () => {
    expect(aiPromptGroupName('n'.repeat(AI_MAX_GROUP_NAME_LENGTH + 5))).toHaveLength(AI_MAX_GROUP_NAME_LENGTH)
    expect(aiPromptGroupName(undefined)).toBe('')
  })
})
