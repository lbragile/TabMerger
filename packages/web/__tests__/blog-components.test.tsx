/**
 * The blog's smaller interactive pieces: share menu (native item, Escape/outside close, icons,
 * LinkedIn copy-first), copy buttons, Helpful, browser switcher, install CTA, screenshot theme
 * toggle, Toc, ScrollReveal, TestedOn and the nav link order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlogPostStateProvider, useBlogPostState } from '@/components/blog/BlogPostState'
import { BlogInstallCta } from '@/components/blog/BlogInstallCta'
import { BrowserPanel, BrowserPanels } from '@/components/blog/BrowserPanels'
import { BrowserSwitcher } from '@/components/blog/BrowserSwitcher'
import { CopyLinkButton } from '@/components/blog/CopyLinkButton'
import { HelpfulButton } from '@/components/blog/HelpfulButton'
import { ScrollReveal } from '@/components/blog/ScrollReveal'
import { ShareMenu } from '@/components/blog/ShareMenu'
import { TestedOn, splitVersion } from '@/components/blog/TestedOn'
import { ScreenshotThemeToggle, ThemedScreenshot } from '@/components/blog/ThemedScreenshot'
import { Toc } from '@/components/toc'
import { NAV_LINKS } from '@/components/layout/navLinks'
import { SHARE_PLATFORMS, emailBody, type ShareContent } from '@/lib/blog/share'
import { STABLE_STORE_LINKS } from '@/lib/storeLinks'
import { evaluateMdx } from './helpers/blogMdx'

const supabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  configured: true,
}))
vi.mock('@/lib/supabase/client', () => ({
  get isSupabaseConfigured() {
    return supabase.configured
  },
  createClient: () => ({
    rpc: supabase.rpc,
    auth: { getSession: supabase.getSession },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: supabase.maybeSingle }) }),
      insert: supabase.insert,
      delete: () => ({ eq: supabase.del }),
    }),
  }),
}))

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/157.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/157.0 Safari/537.36 Edg/157.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; rv:159.0) Gecko/20100101 Firefox/159.0',
}
const setUA = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const content: ShareContent = {
  url: 'https://tabmerger.com/blog/demo',
  title: 'Demo title',
  description: 'Demo description.',
  summary: 'Demo summary.',
  hashtags: ['TabManagement', 'SaveTabs', 'Chrome'],
  origin: 'https://tabmerger.com',
  downloadUrl: 'https://tabmerger.com/download',
  githubUrl: 'https://github.com/lbragile/TabMerger',
}

/** A page-like host: the live region plus whatever is under test. */
function Notice() {
  return <p data-testid="notice">{useBlogPostState().notice}</p>
}
function Page({ children }: { children: React.ReactNode }) {
  return (
    <BlogPostStateProvider>
      {children}
      <Notice />
    </BlogPostStateProvider>
  )
}
const notice = () => screen.getByTestId('notice')

// ── Share menu ────────────────────────────────────────────────────────────────────────────────
describe('ShareMenu', () => {
  const mount = () => render(<ShareMenu content={content} announce={vi.fn()} />)
  const toggle = () => screen.getByRole('button', { name: 'Share' })

  it('offers a native "Share…" item only where navigator.share exists, sending the email body', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(toggle())
    expect(screen.queryByRole('button', { name: 'Share…' })).toBeNull()
    await user.keyboard('{Escape}')
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    try {
      render(<ShareMenu content={content} announce={vi.fn()} />)
      await user.click(screen.getAllByRole('button', { name: 'Share' }).at(-1)!)
      await user.click(screen.getByRole('button', { name: 'Share…' }))
      expect(share).toHaveBeenCalledTimes(1)
      const arg = share.mock.calls[0][0]
      expect(arg.url).toBe(content.url)
      expect(arg.title).toBe(content.title)
      expect(arg.text).toContain(content.description)
      expect(arg.text).toContain(content.url)
      expect(arg.text).not.toContain(content.title)
      expect(typeof arg.text).toBe('string')
      expect(emailBody).toBeTypeOf('function')
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('keeps the menu open when the native share sheet is dismissed', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(new Error('AbortError')), configurable: true })
    try {
      mount()
      await user.click(toggle())
      await user.click(screen.getByRole('button', { name: 'Share…' }))
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    } finally {
      Reflect.deleteProperty(navigator, 'share')
    }
  })

  it('opens as a disclosure, closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup()
    mount()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).not.toHaveAttribute('aria-controls')
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(toggle()).toHaveAttribute('aria-controls', 'blog-share-menu')
    screen.getByRole('link', { name: 'Post on X' }).focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('list', { name: 'Share this article' })).toBeNull()
    expect(document.activeElement).toBe(toggle())
  })

  it('closes on a click outside, without stealing focus', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>elsewhere</button>
        <ShareMenu content={content} announce={vi.fn()} />
      </>
    )
    await user.click(toggle())
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('list', { name: 'Share this article' })).toBeNull()
    expect(document.activeElement).not.toBe(toggle())
  })

  it('lists a link per platform plus copy link, each platform with an icon', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(toggle())
    const list = screen.getByRole('list', { name: 'Share this article' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(SHARE_PLATFORMS.length + 1)
    for (const li of items) expect(li.querySelector('svg')).not.toBeNull()
    expect(within(list).getByRole('link', { name: 'Share on LinkedIn' })).toHaveAttribute('target', '_blank')
    expect(within(list).getByRole('link', { name: 'Share on LinkedIn' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('copy link copies the canonical URL, closes the menu and announces it', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const announce = vi.fn()
    render(<ShareMenu content={content} announce={announce} />)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.click(toggle())
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(content.url)
    expect(announce).toHaveBeenCalledWith('Link copied.')
    expect(screen.queryByRole('list', { name: 'Share this article' })).toBeNull()
  })

  it('LinkedIn copies the post text, opens the composer and says so', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const announce = vi.fn()
    render(<ShareMenu content={content} announce={announce} />)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.click(toggle())
    await user.click(screen.getByRole('link', { name: 'Share on LinkedIn' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain(content.url)
    expect(open).toHaveBeenCalledWith(expect.stringContaining('linkedin.com'), '_blank', 'noopener,noreferrer')
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Post text copied: paste it into LinkedIn'))
  })
})

// ── Copy buttons ──────────────────────────────────────────────────────────────────────────────
describe('copy buttons', () => {
  it('CopyLinkButton copies the URL, swaps its icon, and announces in the live region', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    render(
      <Page>
        <CopyLinkButton url="https://example.com/a" />
      </Page>
    )
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const button = screen.getByRole('button', { name: 'Copy link: https://example.com/a' })
    expect(button).toHaveAttribute('title', 'Copy link: https://example.com/a')
    await user.click(button)
    expect(writeText).toHaveBeenCalledWith('https://example.com/a')
    await waitFor(() => expect(notice()).toHaveTextContent('Link copied.'))
    expect(button.querySelector('svg.lucide-check')).not.toBeNull()
  })

  it('announces the link when the clipboard is refused', async () => {
    const user = userEvent.setup()
    render(
      <Page>
        <CopyLinkButton url="chrome://settings" kind="address" />
      </Page>
    )
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true })
    await user.click(screen.getByRole('button', { name: 'Copy address: chrome://settings' }))
    await waitFor(() => expect(notice()).toHaveTextContent('Couldn’t copy here. The link is chrome://settings'))
  })

  it('MDX: body links and inline browser addresses get copy buttons; in-page anchors and plain code do not', async () => {
    const { Content } = await evaluateMdx(
      [
        'Visit [the docs](https://example.com/docs) and [the FAQ](/faq) and [jump](#top).',
        '',
        'Open `chrome://settings/onStartup`, `edge://settings`, `about:preferences` or `plain code`.',
      ].join('\n')
    )
    const { container } = render(
      <Page>
        <Content />
      </Page>
    )
    expect(screen.getByRole('button', { name: 'Copy link: https://example.com/docs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Copy link: .*\/faq$/ })).toBeInTheDocument()
    for (const url of ['chrome://settings/onStartup', 'edge://settings', 'about:preferences']) {
      expect(screen.getByRole('button', { name: `Copy address: ${url}` })).toBeInTheDocument()
      // A browser-internal address is code, never a link (a web page can't open it).
      expect(container.querySelector(`a[href="${url}"]`)).toBeNull()
    }
    expect(screen.getAllByRole('button', { name: /^Copy / })).toHaveLength(5)
    expect(container.querySelector('a[href="#top"]')?.nextElementSibling).toBeNull()
    expect(container.textContent).toContain('(paste it into the address bar)')
  })

  it('has no copy buttons in site chrome (the share menu and the contents list)', () => {
    render(
      <>
        <ShareMenu content={content} announce={vi.fn()} />
        <Toc variant="article" heading="On this page" items={[{ id: 'a', label: 'A' }]} />
      </>
    )
    expect(screen.queryAllByRole('button', { name: /^Copy (link|address): / })).toHaveLength(0)
  })
})

// ── Helpful ───────────────────────────────────────────────────────────────────────────────────
describe('HelpfulButton', () => {
  const announce = vi.fn()
  const mount = (returnPath = '/blog/demo#helpful') => render(<HelpfulButton slug="demo" returnPath={returnPath} announce={announce} />)
  const button = () => screen.getByRole('button', { name: /^Mark as helpful/ })

  beforeEach(() => {
    announce.mockReset()
    supabase.insert.mockReset()
    supabase.del.mockReset()
    supabase.configured = true
    supabase.rpc.mockResolvedValue({ data: 4, error: null })
    supabase.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } })
    supabase.maybeSingle.mockResolvedValue({ data: null })
    supabase.insert.mockResolvedValue({ error: null })
    supabase.del.mockResolvedValue({ error: null })
  })

  it('shows "–" while loading, then the count', async () => {
    let resolve!: (v: unknown) => void
    supabase.rpc.mockReturnValue(new Promise((r) => (resolve = r)))
    mount()
    expect(button()).toHaveTextContent('–')
    expect(button()).toHaveAttribute('aria-disabled', 'true')
    resolve({ data: 4, error: null })
    await waitFor(() => expect(button()).toHaveAccessibleName('Mark as helpful, 4 people so far'))
  })

  it('signed in, not voted: a click votes at once, bumps the count and announces', async () => {
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'false'))
    await user.click(button())
    expect(supabase.insert).toHaveBeenCalledWith({ post_slug: 'demo' })
    expect(button()).toHaveAttribute('aria-pressed', 'true')
    expect(button()).toHaveTextContent('5')
    expect(announce).toHaveBeenCalledWith('Thanks. Marked as helpful.')
  })

  it('shows an existing vote as pressed, and a second click removes it', async () => {
    const user = userEvent.setup()
    supabase.maybeSingle.mockResolvedValue({ data: { post_slug: 'demo' } })
    mount()
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'true'))
    await user.click(button())
    expect(supabase.del).toHaveBeenCalledWith('post_slug', 'demo')
    expect(button()).toHaveAttribute('aria-pressed', 'false')
    expect(button()).toHaveTextContent('3')
    expect(announce).toHaveBeenCalledWith('Removed your vote.')
  })

  it('treats a unique violation (23505) as already voted: stays marked and takes the real count', async () => {
    const user = userEvent.setup()
    supabase.insert.mockResolvedValue({ error: { code: '23505' } })
    mount()
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'false'))
    supabase.rpc.mockResolvedValue({ data: 9, error: null })
    await user.click(button())
    await waitFor(() => expect(button()).toHaveTextContent('9'))
    expect(button()).toHaveAttribute('aria-pressed', 'true')
    expect(announce).toHaveBeenCalledWith('Thanks. Marked as helpful.')
    expect(announce).not.toHaveBeenCalledWith('Couldn’t save your vote. Try again.')
  })

  it('rolls back and says so on any other error', async () => {
    const user = userEvent.setup()
    supabase.insert.mockResolvedValue({ error: { code: '42501' } })
    mount()
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'false'))
    await user.click(button())
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Couldn’t save your vote. Try again.'))
    expect(button()).toHaveAttribute('aria-pressed', 'false')
    expect(button()).toHaveTextContent('4')
  })

  it('rolls back a failed removal too, and a 23505 on removal is not "already voted"', async () => {
    const user = userEvent.setup()
    supabase.maybeSingle.mockResolvedValue({ data: { post_slug: 'demo' } })
    supabase.del.mockResolvedValue({ error: { code: '23505' } })
    mount()
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'true'))
    await user.click(button())
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Couldn’t save your vote. Try again.'))
    expect(button()).toHaveAttribute('aria-pressed', 'true')
  })

  it('signed out: shows the count, a click opens the sign-in prompt with a safe return path, and never writes', async () => {
    const user = userEvent.setup()
    supabase.getSession.mockResolvedValue({ data: { session: null } })
    mount('/blog/demo#helpful')
    await waitFor(() => expect(button()).toHaveAttribute('aria-expanded', 'false'))
    expect(button()).not.toHaveAttribute('aria-pressed')
    await user.click(button())
    expect(button()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/auth/sign-in?redirectTo=${encodeURIComponent('/blog/demo#helpful')}`)
    expect(screen.getByRole('link', { name: 'Create free account' })).toHaveAttribute('href', '/auth/sign-up')
    expect(announce).toHaveBeenCalledWith('Sign in to mark this as helpful.')
    expect(supabase.insert).not.toHaveBeenCalled()
    await user.click(button())
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })

  it.each(['https://evil.example/x', '//evil.example', '/\\evil.example'])('never lets %s become the sign-in return path', async (bad) => {
    const user = userEvent.setup()
    supabase.getSession.mockResolvedValue({ data: { session: null } })
    mount(bad)
    await waitFor(() => expect(button()).toHaveAttribute('aria-expanded', 'false'))
    await user.click(button())
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/sign-in?redirectTo=%2F')
  })

  it('is signed out from the start when Supabase is not configured, and makes no request', async () => {
    supabase.configured = false
    supabase.rpc.mockClear()
    mount()
    expect(button()).toHaveAttribute('aria-expanded', 'false')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('treats a failed session read as signed out, and an unusable count as unknown', async () => {
    supabase.getSession.mockRejectedValue(new Error('offline'))
    supabase.rpc.mockResolvedValue({ data: -3, error: null })
    mount()
    await waitFor(() => expect(button()).toHaveAttribute('aria-expanded', 'false'))
    expect(button()).toHaveTextContent('–')
  })

  it('ignores clicks while loading', async () => {
    supabase.getSession.mockReturnValue(new Promise(() => {}))
    mount()
    fireEvent.click(button())
    expect(supabase.insert).not.toHaveBeenCalled()
  })
})

// ── Browser switcher, panels, install CTA, theme toggle ───────────────────────────────────────
describe('BrowserSwitcher', () => {
  const mount = (ua?: string) => {
    if (ua) setUA(ua)
    return render(
      <BlogPostStateProvider browserSections={['bookmark']}>
        <BrowserSwitcher />
        <BrowserPanels section="bookmark">
          <BrowserPanel browser="chrome">C</BrowserPanel>
          <BrowserPanel browser="edge">E</BrowserPanel>
          <BrowserPanel browser="firefox">F</BrowserPanel>
        </BrowserPanels>
      </BlogPostStateProvider>
    )
  }
  const tab = (name: string) => screen.getByRole('tab', { name })

  it.each([
    ['chrome', 'Chrome'],
    ['edge', 'Edge'],
    ['firefox', 'Firefox'],
  ] as const)('defaults to the reader’s browser from the User-Agent (%s)', async (key, name) => {
    mount(UA[key])
    await waitFor(() => expect(tab(name)).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1)
  })

  it('shows every panel in the HTML but only the selected one', () => {
    const { container } = mount()
    const panels = container.querySelectorAll('[role="tabpanel"]')
    expect([...panels].map((p) => p.hasAttribute('hidden'))).toEqual([false, true, true])
    expect(tab('Chrome')).toHaveAttribute('aria-controls', 'bookmark-chrome')
  })

  it('moves and selects with the arrow keys (wrapping), Home and End; only the selected tab is tabbable', async () => {
    const user = userEvent.setup()
    mount()
    tab('Chrome').focus()
    await user.keyboard('{ArrowRight}')
    expect(tab('Edge')).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(tab('Edge'))
    expect(tab('Chrome')).toHaveAttribute('tabindex', '-1')
    await user.keyboard('{End}')
    expect(tab('Firefox')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(tab('Chrome')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(tab('Firefox')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(tab('Chrome')).toHaveAttribute('aria-selected', 'true')
  })

  it('mirrors the arrow keys in right-to-left', async () => {
    const user = userEvent.setup()
    mount()
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
      el instanceof HTMLElement && el.getAttribute('role') === 'tablist' ? ({ direction: 'rtl' } as CSSStyleDeclaration) : real(el, pseudo)
    )
    tab('Chrome').focus()
    await user.keyboard('{ArrowLeft}')
    expect(tab('Edge')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(tab('Chrome')).toHaveAttribute('aria-selected', 'true')
  })

  it('a click overrides the detected browser', async () => {
    const user = userEvent.setup()
    mount(UA.firefox)
    await user.click(tab('Edge'))
    expect(tab('Edge')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Firefox')).toHaveAttribute('aria-selected', 'false')
  })
})

describe('BlogInstallCta', () => {
  const links = { ...STABLE_STORE_LINKS }
  const order = (container: HTMLElement) => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))

  it.each([
    ['chrome', ['chrome', 'firefox', 'edge']],
    ['edge', ['edge', 'chrome', 'firefox']],
    ['firefox', ['firefox', 'chrome', 'edge']],
  ] as const)('leads with the reader’s browser (%s) and keeps the others in order', async (key, expected) => {
    setUA(UA[key])
    const { container } = render(<BlogInstallCta links={links} />)
    await waitFor(() => expect(order(container)).toEqual(expected.map((b) => links[b])))
    expect(container.querySelector('a[data-primary]')?.getAttribute('href')).toBe(links[key])
  })

  it('the compact layout puts the reader’s browser full width and names the others by their browser', async () => {
    setUA(UA.edge)
    const { container } = render(<BlogInstallCta links={links} layout="compact" />)
    await waitFor(() => expect(container.querySelector('a[data-primary]')?.getAttribute('href')).toBe(links.edge))
    expect(screen.getByRole('group', { name: 'Install TabMerger' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add to Chrome' })).toBeInTheDocument()
  })
})

describe('ScreenshotThemeToggle', () => {
  it('overrides the theme of every TabMerger capture and shows the one in effect as pressed', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <BlogPostStateProvider>
        <ScreenshotThemeToggle />
        <ThemedScreenshot src="/blog/demo/tm" alt="Light" darkAlt="Dark" />
      </BlogPostStateProvider>
    )
    expect(container.querySelectorAll('img')).toHaveLength(2)
    const group = screen.getByRole('group', { name: 'TabMerger screenshot theme' })
    expect(within(group).getByRole('button', { name: 'Light screenshots' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(group).getByRole('button', { name: 'Dark screenshots' }))
    expect(within(group).getByRole('button', { name: 'Dark screenshots' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Light screenshots' })).toHaveAttribute('aria-pressed', 'false')
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toMatch(/tm-dark\.webp$/)
  })
})

// ── Toc, ScrollReveal, TestedOn, nav ──────────────────────────────────────────────────────────
describe('Toc (article)', () => {
  const items = [
    { id: 'one', label: 'One' },
    { id: 'two', label: 'Two' },
    { id: 'three', label: 'Three' },
  ]
  let callback: IntersectionObserverCallback

  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    )
    for (const item of items) {
      const el = document.createElement('section')
      el.id = item.id
      document.body.appendChild(el)
    }
  })
  afterEach(() => {
    for (const item of items) document.getElementById(item.id)?.remove()
  })

  it('marks the first section current, then follows the section in view with aria-current="location"', () => {
    render(<Toc variant="article" heading="On this page" items={items} />)
    const current = () => screen.getAllByRole('link', { hidden: true }).filter((a) => a.getAttribute('aria-current') === 'location')
    expect(current().map((a) => a.textContent)).toEqual(['One'])
    act(() => callback([{ isIntersecting: true, target: document.getElementById('three')! } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(current().map((a) => a.textContent)).toEqual(['Three'])
  })

  it('moves the indicator bar to the current link, and a click selects its section', async () => {
    const user = userEvent.setup()
    const { container } = render(<Toc variant="article" heading="On this page" items={items} />)
    const bar = container.querySelector('nav ol > span[aria-hidden="true"]') as HTMLElement
    await waitFor(() => expect(bar.style.opacity).toBe('1'))
    await user.click(screen.getByRole('link', { name: 'Two', hidden: true }))
    expect(screen.getByRole('link', { name: 'Two', hidden: true })).toHaveAttribute('aria-current', 'location')
    expect(bar.style.transform).toMatch(/translateY\(/)
    expect(screen.getByRole('navigation', { name: 'On this page', hidden: true })).toBeInTheDocument()
  })
})

describe('ScrollReveal', () => {
  let observed: Element[]
  beforeEach(() => {
    observed = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(el: Element) {
          observed.push(el)
        }
        unobserve() {}
        disconnect() {}
      }
    )
    document.body.innerHTML = '<article class="blog-article"><section class="blog-section" id="s1"></section></article>'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000 } as DOMRect)
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })
  const motion = (reduce: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') && reduce, addEventListener() {}, removeEventListener() {} }))

  it('holds back sections below the fold when motion is allowed', () => {
    motion(false)
    render(<ScrollReveal />)
    expect(document.getElementById('s1')?.dataset.reveal).toBe('pending')
    expect(observed).toHaveLength(1)
  })

  it('under reduced motion holds nothing back and observes nothing', () => {
    motion(true)
    render(<ScrollReveal />)
    expect(document.getElementById('s1')?.dataset.reveal).toBeUndefined()
    expect(observed).toHaveLength(0)
  })

  it('shows everything again when it unmounts', () => {
    motion(false)
    const { unmount } = render(<ScrollReveal />)
    unmount()
    expect(document.getElementById('s1')?.dataset.reveal).toBeUndefined()
  })
})

describe('TestedOn', () => {
  it('shows the major version, with the full build in the title and in screen-reader text', () => {
    render(<TestedOn versions={['Chrome 157.0.8103.79', 'Firefox 159.0.1']} />)
    const list = screen.getByRole('list', { name: 'Tested on' })
    const [chrome, firefox] = within(list).getAllByRole('listitem')
    expect(chrome).toHaveAttribute('title', 'Chrome 157.0.8103.79')
    expect(chrome.querySelector('[aria-hidden="true"]:not(span.inline-flex)')).toHaveTextContent('Chrome 157')
    expect(chrome.querySelector('.sr-only')).toHaveTextContent('Chrome 157.0.8103.79')
    expect(firefox.querySelector('.sr-only')).toHaveTextContent('Firefox 159.0.1')
  })

  it('splits versions, and keeps an entry without one whole; renders nothing for an empty list', () => {
    expect(splitVersion('Edge 157.0.4341.60')).toEqual({ name: 'Edge', major: 'Edge 157' })
    expect(splitVersion('TabMerger')).toEqual({ name: 'TabMerger', major: 'TabMerger' })
    const { container } = render(<TestedOn versions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('main navigation', () => {
  it('puts Blog between Compare and Changelog', () => {
    const labels = NAV_LINKS.map((l) => l.label)
    expect(labels.indexOf('blog')).toBe(labels.indexOf('compare') + 1)
    expect(labels.indexOf('changelog')).toBe(labels.indexOf('blog') + 1)
    expect(NAV_LINKS.find((l) => l.label === 'blog')?.href).toBe('/blog')
  })
})
