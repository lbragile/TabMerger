import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ openInGroup: vi.fn() }))
vi.mock('@/lib/chromeGroups', () => ({ openTabInChromeGroup: h.openInGroup }))

import { FALLBACK_FAVICON, getSiteDisplay, getUrlDisplay, openSavedTab } from '@/lib/savedTab'

const create = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { chrome?: unknown }).chrome = { tabs: { create }, tabGroups: {} }
})

describe('getSiteDisplay', () => {
  it('is the hostname without www., never the path or query', () => {
    expect(getSiteDisplay('https://www.example.com/docs/a?x=1#top')).toBe('example.com')
    expect(getSiteDisplay('https://news.ycombinator.com/')).toBe('news.ycombinator.com')
  })

  it('falls back to the address for a URL without a host, and is empty for nothing or junk', () => {
    expect(getSiteDisplay('file:///C:/notes/today.txt')).toBe(getUrlDisplay('file:///C:/notes/today.txt'))
    expect(getSiteDisplay(undefined)).toBe('')
    expect(getSiteDisplay('not a url')).toBe('')
  })
})

describe('getUrlDisplay', () => {
  it('is empty for a missing or unparsable URL', () => {
    expect(getUrlDisplay(undefined)).toBe('')
    expect(getUrlDisplay('')).toBe('')
    expect(getUrlDisplay('not a url')).toBe('')
  })

  it('strips www., the trailing slash, the query and the hash', () => {
    expect(getUrlDisplay('https://www.example.com/')).toBe('example.com')
    expect(getUrlDisplay('https://example.com/docs?x=1#top')).toBe('example.com/docs')
  })

  it('cuts a long path at 15 characters (the leading slash counts) with an ellipsis', () => {
    expect(getUrlDisplay('https://example.com/abcdefghijklmnopqrstuvwxyz')).toBe('example.com/abcdefghijklmn...')
  })
})

describe('openSavedTab', () => {
  it('opens a plain tab, focused', async () => {
    await openSavedTab({ id: 0, title: 'a', url: 'https://a.test/' })
    expect(create).toHaveBeenCalledWith({ url: 'https://a.test/', active: true })
    expect(h.openInGroup).not.toHaveBeenCalled()
  })

  it('opens inside its browser tab group when it was saved in one', async () => {
    const tab = { id: 0, title: 'a', url: 'https://a.test/', chromeGroup: { id: 1, name: 'G', color: 'blue' } }
    await openSavedTab(tab)
    expect(h.openInGroup).toHaveBeenCalledWith(tab, undefined, true)
    expect(create).not.toHaveBeenCalled()
  })

  it('opens a plain tab when the browser has no tab groups', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = { tabs: { create } }
    await openSavedTab({ id: 0, title: 'a', url: 'https://a.test/', chromeGroup: { id: 1, name: 'G', color: 'blue' } })
    expect(create).toHaveBeenCalledWith({ url: 'https://a.test/', active: true })
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', ''])('does nothing for %j', async (url) => {
    await openSavedTab({ id: 0, title: 'x', url })
    expect(create).not.toHaveBeenCalled()
    expect(h.openInGroup).not.toHaveBeenCalled()
  })

  it('exposes an svg data URI fallback favicon', () => {
    expect(FALLBACK_FAVICON.startsWith('data:image/svg+xml,')).toBe(true)
  })
})
