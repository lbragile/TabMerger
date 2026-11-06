/**
 * The header's account slot (components/layout/NavAccount.tsx), resolved in the browser so the
 * marketing pages can be rendered at build time: a skeleton (busy, labelled, sized like the
 * signed-out buttons) until `getSession()` answers, then the account menu or Sign in / Get started.
 * The mobile panel follows the same state.
 */
import { act, render, screen, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { IntlWrapper } from './helpers/intl'

type AuthCallback = (event: string, session: Session | null) => void

const { auth, authListeners, unsubscribe } = vi.hoisted(() => {
  const authListeners: AuthCallback[] = []
  const unsubscribe = vi.fn()
  return {
    authListeners,
    unsubscribe,
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn((cb: AuthCallback) => {
        authListeners.push(cb)
        return { data: { subscription: { unsubscribe } } }
      }),
    },
  }
})
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }))

// The real menu is a lazy Radix chunk; a stand-in shows what it was given.
const { preloadAccountMenu } = vi.hoisted(() => ({ preloadAccountMenu: vi.fn() }))
vi.mock('@/components/layout/AccountMenuLoader', () => ({
  preloadAccountMenu,
  AccountMenuLoader: ({ email, initials }: { email: string; initials?: string }) => (
    <button type="button" aria-label="Account menu" data-email={email}>
      {initials}
    </button>
  ),
}))

import { NavAccountProvider, NavAccountSlot, SESSION_HINT_SCRIPT, accountStateFor } from '@/components/layout/NavAccount'
import { MobileNavToggle } from '@/components/layout/MobileNavToggle'

const session = (email: string | undefined) => ({ user: { id: 'u1', email } }) as unknown as Session

/** A getSession() that answers only when the test says so. */
function deferredSession() {
  let resolve!: (value: { data: { session: Session | null } }) => void
  auth.getSession.mockReturnValue(new Promise((r) => (resolve = r)))
  return (s: Session | null) => act(async () => resolve({ data: { session: s } }))
}

function Header() {
  return (
    <NavAccountProvider>
      <div data-testid="desktop">
        <NavAccountSlot />
      </div>
      <MobileNavToggle />
    </NavAccountProvider>
  )
}

beforeEach(() => {
  auth.getSession.mockReset()
  auth.onAuthStateChange.mockClear()
  unsubscribe.mockClear()
  authListeners.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('accountStateFor', () => {
  it('is signed out without a session or user', () => {
    expect(accountStateFor(null)).toEqual({ status: 'signedOut' })
    expect(accountStateFor(undefined)).toEqual({ status: 'signedOut' })
  })

  it('takes the first two letters of the email, upper-cased, as initials', () => {
    expect(accountStateFor(session('someone@example.test'))).toEqual({
      status: 'signedIn',
      email: 'someone@example.test',
      initials: 'SO',
    })
  })

  it('handles a user without an email', () => {
    expect(accountStateFor(session(undefined))).toEqual({ status: 'signedIn', email: '', initials: undefined })
  })
})

describe('NavAccountSlot', () => {
  it('shows a busy, labelled skeleton until the session is read', async () => {
    deferredSession()
    render(<Header />)
    const desktop = screen.getByTestId('desktop')
    const busy = desktop.querySelector('[aria-busy="true"]')
    expect(busy).not.toBeNull()
    expect(within(desktop).getByText('Loading account')).toHaveClass('sr-only')
    // No real controls yet: nothing to click, nothing announced but the label.
    expect(within(desktop).queryByRole('link')).toBeNull()
    expect(within(desktop).queryByRole('button')).toBeNull()
  })

  it('sizes the skeleton from the real signed-out labels and classes, hidden from assistive tech', () => {
    deferredSession()
    render(<Header />)
    const placeholder = screen.getByTestId('desktop').querySelector('[aria-hidden="true"]')!
    expect(placeholder).toHaveTextContent('Sign inGet started')
    const boxes = placeholder.querySelectorAll('.invisible')
    expect(boxes).toHaveLength(2)
    expect(boxes[0].className).toContain('h-9')
    expect(boxes[0].className).toContain('border-transparent')
    expect(boxes[1].className).toContain('border-primary')
  })

  it('does not pulse for visitors who ask for reduced motion', () => {
    deferredSession()
    render(<Header />)
    const pulses = screen.getByTestId('desktop').querySelectorAll('.animate-pulse')
    expect(pulses.length).toBeGreaterThan(0)
    for (const pulse of pulses) expect(pulse).toHaveClass('motion-reduce:animate-none')
  })

  it('shows Sign in and Get started once the session is read and there is none', async () => {
    const answer = deferredSession()
    render(<Header />)
    await answer(null)
    const desktop = screen.getByTestId('desktop')
    expect(within(desktop).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/sign-in')
    expect(within(desktop).getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/auth/sign-up')
    expect(desktop.querySelector('[aria-busy]')).toBeNull()
  })

  it('shows the account menu with the email and initials when signed in', async () => {
    const answer = deferredSession()
    render(<Header />)
    await answer(session('someone@example.test'))
    const menu = within(screen.getByTestId('desktop')).getByRole('button', { name: 'Account menu' })
    expect(menu).toHaveAttribute('data-email', 'someone@example.test')
    expect(menu).toHaveTextContent('SO')
  })

  it('falls back to signed out when reading the session fails', async () => {
    auth.getSession.mockRejectedValue(new Error('storage unavailable'))
    render(<Header />)
    expect(await within(screen.getByTestId('desktop')).findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('follows a later sign-in or sign-out', async () => {
    const answer = deferredSession()
    render(<Header />)
    await answer(null)
    await act(async () => authListeners.forEach((cb) => cb('SIGNED_IN', session('ab@example.test'))))
    expect(within(screen.getByTestId('desktop')).getByRole('button', { name: 'Account menu' })).toHaveTextContent('AB')
    await act(async () => authListeners.forEach((cb) => cb('SIGNED_OUT', null)))
    expect(within(screen.getByTestId('desktop')).getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('stops listening when unmounted, and ignores a session read that answers afterwards', async () => {
    const answer = deferredSession()
    const { unmount } = render(<Header />)
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await answer(session('late@example.test'))
    expect(error).not.toHaveBeenCalled()
  })

  it('server-renders the skeleton with a <noscript> fallback that hides it and offers the sign-in links', () => {
    const html = renderToStaticMarkup(
      <IntlWrapper>
        <Header />
      </IntlWrapper>
    )
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('data-nav-account-skeleton')
    const noscript = html.slice(html.indexOf('<noscript>'), html.indexOf('</noscript>'))
    expect(noscript).toContain('[data-nav-account-skeleton]{display:none}')
    expect(noscript).toContain('href="/auth/sign-in"')
    expect(noscript).toContain('href="/auth/sign-up"')
    expect(auth.getSession).not.toHaveBeenCalled()
  })
})

describe('account menu preload', () => {
  afterEach(() => {
    document.cookie = 'sb-proj-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    preloadAccountMenu.mockClear()
  })

  it('starts loading the menu chunk at mount when the session cookie is there', () => {
    document.cookie = 'sb-proj-auth-token=x'
    deferredSession()
    render(<Header />)
    // Before the session read has answered (idempotent: Strict Mode may run the effect twice).
    expect(preloadAccountMenu).toHaveBeenCalled()
  })

  it('does not preload for a visitor without the cookie until a session resolves', async () => {
    const answer = deferredSession()
    render(<Header />)
    expect(preloadAccountMenu).not.toHaveBeenCalled()
    await answer(null)
    expect(preloadAccountMenu).not.toHaveBeenCalled()
    await act(async () => authListeners.forEach((cb) => cb('SIGNED_IN', session('ab@example.test'))))
    expect(preloadAccountMenu).toHaveBeenCalled()
  })
})

describe('session size hint (pre-paint script)', () => {
  /** Runs the inline script as the parser would, right after the skeleton. */
  function runHint(cookie: string) {
    const skeleton = document.createElement('div')
    const script = document.createElement('script')
    document.body.append(skeleton, script)
    // The script reads only `document.cookie` and `document.currentScript`.
    new Function('document', SESSION_HINT_SCRIPT)({ cookie, currentScript: script })
    skeleton.remove()
    script.remove()
    return skeleton.getAttribute('data-session')
  }

  it.each([
    'sb-abcdefgh-auth-token=base64-xyz',
    'theme=dark; sb-abcdefgh-auth-token=base64-xyz',
    'sb-abcdefgh-auth-token.0=part; sb-abcdefgh-auth-token.1=part',
  ])('sizes the skeleton for the account button when the session cookie is present (%s)', (cookie) => {
    expect(runHint(cookie)).toBe('in')
  })

  it.each(['', 'theme=dark', 'xsb-a-auth-token=1', 'sb-a-auth-token-code-verifier=1', 'tm_consent=granted'])(
    "keeps the sign-in buttons' box without one (%s)",
    (cookie) => {
      expect(runHint(cookie)).toBeNull()
    }
  )

  it('server-renders the script right after the skeleton, with an account-button-sized block hidden by default', () => {
    deferredSession()
    const html = renderToStaticMarkup(
      <IntlWrapper>
        <Header />
      </IntlWrapper>
    )
    expect(html).toContain(`</div><script>${SESSION_HINT_SCRIPT}</script>`)
    const signedInBlock = html.match(/<div[^>]*data-testid="nav-account-skeleton-signed-in"[^>]*>/)?.[0] ?? ''
    expect(signedInBlock).toContain('hidden group-data-[session=in]:block')
    expect(signedInBlock).toContain('h-9 w-9')
  })
})

describe('MobileNavToggle account rows', () => {
  async function openPanel() {
    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open menu' }))
    })
  }

  it('shows one busy skeleton row when opened before the session is read', async () => {
    deferredSession()
    render(<Header />)
    await openPanel()
    const panel = screen.getByRole('navigation')
    const busy = panel.querySelector('[aria-busy="true"]')!
    expect(busy).not.toBeNull()
    expect(within(busy as HTMLElement).getByText('Loading account')).toHaveClass('sr-only')
    expect(busy.querySelector('.animate-pulse')).toHaveClass('motion-reduce:animate-none')
    expect(within(panel).queryByRole('link', { name: 'Sign in' })).toBeNull()
  })

  it('replaces the skeleton row with the sign-in links once signed out is known', async () => {
    const answer = deferredSession()
    render(<Header />)
    await openPanel()
    await answer(null)
    const panel = screen.getByRole('navigation')
    expect(panel.querySelector('[aria-busy]')).toBeNull()
    expect(within(panel).getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the email, dashboard, account and sign-out when signed in', async () => {
    const answer = deferredSession()
    render(<Header />)
    await answer(session('someone@example.test'))
    await openPanel()
    const panel = screen.getByRole('navigation')
    expect(within(panel).getByText('someone@example.test')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Account' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
