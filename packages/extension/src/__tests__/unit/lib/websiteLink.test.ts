import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import { openInNewTab, websiteHomeUrl } from '@/lib/websiteLink'

describe('websiteHomeUrl', () => {
  it.each([
    ['stable', 'https://tabmerger.com', 'https://tabmerger.com/en'],
    ['beta', 'https://preview.tabmerger.com', 'https://preview.tabmerger.com/en'],
    ['development', 'http://localhost:3000', 'http://localhost:3000/en'],
  ])('links a %s build to its own site', (_build, env, expected) => {
    expect(websiteHomeUrl(env, 'en')).toBe(expected)
  })

  it.each([
    ['en', 'https://tabmerger.com/en'],
    ['de', 'https://tabmerger.com/de'],
    ['es', 'https://tabmerger.com/es'],
    ['fr', 'https://tabmerger.com/fr'],
    ['it', 'https://tabmerger.com/it'],
    ['ru', 'https://tabmerger.com/ru'],
    ['ko', 'https://tabmerger.com/ko'],
    ['ja', 'https://tabmerger.com/ja'],
    ['pt-BR', 'https://tabmerger.com/pt-BR'],
    ['zh-CN', 'https://tabmerger.com/zh-CN'],
  ])('links to the prefixed %s home, English included', (locale, expected) => {
    expect(websiteHomeUrl('https://tabmerger.com', locale)).toBe(expected)
  })

  it.each([[undefined], ['en-XA'], ['ar'], ['de-AT'], ['EN'], ['../admin']])(
    'links to the English home for %s (unknown or not shipped)',
    (locale) => {
      expect(websiteHomeUrl('https://tabmerger.com', locale)).toBe('https://tabmerger.com/en')
    }
  )

  it('keeps only the origin of the configured URL', () => {
    expect(websiteHomeUrl('https://user:pass@tabmerger.com/some/path?q=1#x', 'de')).toBe('https://tabmerger.com/de')
    expect(websiteHomeUrl('https://tabmerger.com/', 'en')).toBe('https://tabmerger.com/en')
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a URL', 'tabmerger.com'],
    ['a script URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hi'],
    ['another scheme', 'ftp://tabmerger.com'],
    ['not a string', 42],
  ])('gives no URL when the configured value is %s', (_label, env) => {
    expect(websiteHomeUrl(env, 'de')).toBeUndefined()
  })
})

describe('openInNewTab', () => {
  const url = 'https://tabmerger.com/'

  function clickEvent() {
    return { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement> & { preventDefault: ReturnType<typeof vi.fn> }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the page in a new active tab and stops the link navigating', () => {
    const create = vi.fn().mockResolvedValue({})
    vi.stubGlobal('chrome', { tabs: { create } })
    const event = clickEvent()
    openInNewTab(event, url)
    expect(create).toHaveBeenCalledWith({ url, active: true })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('leaves the click to the link when the tabs API is missing', () => {
    vi.stubGlobal('chrome', {})
    const event = clickEvent()
    openInNewTab(event, url)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('falls back to window.open when creating the tab is rejected', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    vi.stubGlobal('chrome', { tabs: { create: vi.fn().mockRejectedValue(new Error('no')) } })
    openInNewTab(clickEvent(), url)
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer'))
  })

  it('falls back to window.open when creating the tab throws', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    vi.stubGlobal('chrome', {
      tabs: {
        create: vi.fn(() => {
          throw new Error('no')
        }),
      },
    })
    openInNewTab(clickEvent(), url)
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
  })

  it('accepts a callback-style tabs API that returns nothing', () => {
    const create = vi.fn(() => undefined)
    vi.stubGlobal('chrome', { tabs: { create } })
    const event = clickEvent()
    openInNewTab(event, url)
    expect(create).toHaveBeenCalledWith({ url, active: true })
    expect(event.preventDefault).toHaveBeenCalled()
  })
})
