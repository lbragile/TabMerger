/**
 * The blog's share links: each platform gets text written for it (exact English below), every
 * link carries the post's canonical URL, the platforms with a title field never repeat it in the
 * body, the short platforms stay within their limits in every language, and the platforms that may
 * drop prefilled text get it copied to the clipboard before they open.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createTranslator } from 'next-intl'
import { ShareMenu } from '@/components/blog/ShareMenu'
import {
  BLUESKY_LIMIT,
  COPY_FIRST,
  HAS_TITLE_FIELD,
  SHARE_PLATFORMS,
  THREADS_LIMIT,
  X_LIMIT,
  blueskyText,
  graphemeCount,
  shareLinks,
  shareText,
  threadsText,
  xLength,
  xText,
  type ShareContent,
  type ShareStrings,
} from '@/lib/blog/share'

const content: ShareContent = {
  url: 'https://tabmerger.com/blog/save-all-open-tabs',
  title: 'How to save all open tabs and get them back later',
  description: 'Save every open tab in Chrome, Edge or Firefox with one shortcut, make tabs reopen after a restart, and get closed tabs back.',
  summary: 'One shortcut, startup restore and closed-tab recovery in Chrome, Edge and Firefox.',
  hashtags: ['TabManagement', 'SaveTabs', 'RestoreClosedTabs'],
  origin: 'https://tabmerger.com',
  downloadUrl: 'https://tabmerger.com/download',
  githubUrl: 'https://github.com/lbragile/TabMerger',
}

const MESSAGES = join(__dirname, '..', 'messages')
const locales = readdirSync(MESSAGES).filter((l) => existsSync(join(MESSAGES, l, 'blog.json')))

function stringsFor(locale: string): ShareStrings {
  const blog = JSON.parse(readFileSync(join(MESSAGES, locale, 'blog.json'), 'utf8'))
  const t = createTranslator({ locale: locale as never, messages: { blog }, namespace: 'blog.interactive' as never }) as unknown as (
    key: string,
    values?: Record<string, string>
  ) => string
  return {
    readGuide: t('shareReadGuide', { url: content.url }),
    about: t('shareAbout'),
    download: t('shareDownload', { url: content.downloadUrl }),
    webApp: t('shareWebApp', { url: content.origin }),
    github: t('shareGitHub', { url: content.githubUrl }),
    redditFooter: t('shareRedditFooter', { download: content.downloadUrl, github: content.githubUrl }),
  }
}

const en = stringsFor('en')

describe('share text per platform (English)', () => {
  it('X: title, summary, link, two hashtags', () => {
    expect(shareText('x', content, en)).toBe(
      [content.title, content.summary, content.url, '#TabManagement #SaveTabs'].join('\n')
    )
  })

  it('LinkedIn: title, description, the guide, the TabMerger lines, three hashtags', () => {
    expect(shareText('linkedIn', content, en)).toBe(
      [
        content.title,
        '',
        content.description,
        '',
        `📖 Read the guide: ${content.url}`,
        '',
        'TabMerger is a free, open-source tab manager:',
        `⬇️ Download: ${content.downloadUrl}`,
        `🌐 Web app: ${content.origin}`,
        `💻 GitHub: ${content.githubUrl}`,
        '',
        '#TabManagement #SaveTabs #RestoreClosedTabs',
      ].join('\n')
    )
  })

  it('WhatsApp bolds the title and has no hashtags; Telegram leaves the link to its url field', () => {
    const whatsApp = shareText('whatsApp', content, en)
    expect(whatsApp.startsWith(`*${content.title}*\n`)).toBe(true)
    expect(whatsApp).not.toContain('#')
    const telegram = shareText('telegram', content, en)
    expect(telegram).not.toContain(content.url)
    expect(telegram).toContain(`⬇️ Download: ${content.downloadUrl}`)
  })

  it('Reddit: plain body without the title, the post link (it is the embed), emoji or hashtags', () => {
    expect(shareText('reddit', content, en)).toBe(
      [content.description, '', `TabMerger (free, open source): ${content.downloadUrl} · GitHub: ${content.githubUrl}`].join('\n')
    )
  })

  it.each(['x', 'linkedIn', 'whatsApp', 'threads', 'bluesky', 'email'] as const)(
    '%s: the first link in the text is the post (the preview card)',
    (platform) => {
      expect(shareText(platform, content, en).match(/https?:\/\/\S+/)?.[0]).toBe(content.url)
    }
  )

  it('Email: body without the title, plain labels', () => {
    expect(shareText('email', content, en)).toBe(
      [
        content.description,
        '',
        `Read the guide: ${content.url}`,
        '',
        'TabMerger is a free, open-source tab manager:',
        `Download: ${content.downloadUrl}`,
        `Web app: ${content.origin}`,
        `GitHub: ${content.githubUrl}`,
      ].join('\n')
    )
  })

  it('Bluesky and Threads: title, summary, link, three hashtags (Threads adds the download link)', () => {
    const tags = '#TabManagement #SaveTabs #RestoreClosedTabs'
    expect(blueskyText(content)).toBe([content.title, content.summary, content.url, tags].join('\n'))
    expect(threadsText(content)).toBe([content.title, content.summary, content.url, `⬇️ ${content.downloadUrl}`, tags].join('\n'))
  })

  it.each([...HAS_TITLE_FIELD])('%s never repeats the title in its body', (platform) => {
    expect(shareText(platform, content, en)).not.toContain(content.title)
  })

  it.each(['reddit', 'email'] as const)('%s has no emoji or hashtags', (platform) => {
    const text = shareText(platform, content, en)
    expect(text).not.toMatch(/#\w/)
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

describe('share links', () => {
  const links = shareLinks(content, en)

  it.each(SHARE_PLATFORMS)('%s carries the encoded post URL and no placeholder', (platform) => {
    expect(links[platform]).toContain(encodeURIComponent(content.url))
    expect(decodeURIComponent(links[platform])).not.toMatch(/undefined|\{\w+\}/)
  })

  it('uses each platform composer', () => {
    expect(links.x).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/)
    expect(links.linkedIn).toMatch(/^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true&text=/)
    expect(links.reddit).toBe(
      `https://www.reddit.com/submit?type=LINK&url=${encodeURIComponent(content.url)}&title=${encodeURIComponent(content.title)}&text=${encodeURIComponent(shareText('reddit', content, en))}`
    )
    expect(new URL(links.telegram).searchParams.get('url')).toBe(content.url)
    expect(new URL(links.facebook).searchParams.get('u')).toBe(content.url)
    expect(links.facebook).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(content.url)}`)
    expect(links.threads).toMatch(/^https:\/\/www\.threads\.net\/intent\/post\?text=/)
    expect(links.telegram).toMatch(/^https:\/\/t\.me\/share\/url\?url=.+&text=/)
    expect(links.email).toMatch(/^mailto:\?subject=.+&body=/)
  })

  it('X shortens a long title to fit', () => {
    expect(xLength(xText({ ...content, title: 'T'.repeat(400) }))).toBeLessThanOrEqual(X_LIMIT)
  })

  it.each(locales)('stays within X, Bluesky and Threads limits in %s', (locale) => {
    const strings = stringsFor(locale)
    for (const [platform, ok] of [
      ['x', (text: string) => xLength(text) <= X_LIMIT],
      ['bluesky', (text: string) => graphemeCount(text) <= BLUESKY_LIMIT],
      ['threads', (text: string) => [...text].length <= THREADS_LIMIT],
    ] as const) {
      const text = shareText(platform, content, strings)
      expect(ok(text), `${platform} in ${locale}`).toBe(true)
      expect(text).toContain(content.url)
    }
  })
})

describe('ShareMenu copy-first platforms', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([...COPY_FIRST])('%s copies the post text before opening the composer', async (platform) => {
    const calls: string[] = []
    const writeText = vi.fn(async () => {
      calls.push('copy')
    })
    // After userEvent.setup(), which installs its own clipboard stub.
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const open = vi.spyOn(window, 'open').mockImplementation(() => {
      calls.push('open')
      return null
    })
    const announce = vi.fn()
    render(<ShareMenu content={content} announce={announce} />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    const label = { linkedIn: 'Share on LinkedIn', reddit: 'Post on Reddit', facebook: 'Share on Facebook' }[platform as 'linkedIn']
    await user.click(screen.getByRole('link', { name: label }))
    expect(calls).toEqual(['copy', 'open'])
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(content.description))
    expect(open.mock.calls[0][0]).toContain(encodeURIComponent(content.url))
    await vi.waitFor(() => expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Post text copied: paste it into /)))
  })

  it('shows the post text to copy by hand when the clipboard is refused', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) }, configurable: true })
    vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<ShareMenu content={content} announce={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('link', { name: 'Share on LinkedIn' }))
    const field = await screen.findByLabelText('Post text')
    expect((field as HTMLTextAreaElement).value).toContain(content.githubUrl)
  })
})

describe('social card', () => {
  it('og.png is a 1200×630 PNG under 1 MB', () => {
    const file = join(__dirname, '..', 'public', 'blog', 'save-all-open-tabs', 'og.png')
    const png = readFileSync(file)
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    // IHDR: width and height are the big-endian 32-bit integers at bytes 16 and 20.
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    expect(png.length).toBeLessThan(1024 * 1024)
  })
})
