import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import BetaPage from '@/app/(marketing)/beta/page'

describe('BetaPage', () => {
  it('renders the hero with a Join the beta button pointing to the tester Google Group', () => {
    render(<BetaPage />)
    expect(screen.getByRole('heading', { name: /help us test tabmerger/i })).toBeInTheDocument()
    const joinLink = screen.getByRole('link', { name: /join the beta/i })
    expect(joinLink).toHaveAttribute('href', 'https://groups.google.com/g/tabmerger-beta-testers')
    expect(joinLink).toHaveAttribute('target', '_blank')
    expect(joinLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('links the bug report button to a prefilled GitHub Discussions Q&A post', () => {
    render(<BetaPage />)
    const bugLink = screen.getByRole('link', { name: /report a bug on github/i })
    const href = bugLink.getAttribute('href') ?? ''
    expect(href).toMatch(/^https:\/\/github\.com\/lbragile\/TabMerger\/discussions\/new\?/)
    expect(href).toMatch(/category=q-a/)
    expect(decodeURIComponent(href.replace(/\+/g, '%20'))).toMatch(/Steps to reproduce/)
    expect(bugLink).toHaveAttribute('target', '_blank')
    expect(bugLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('links the idea button to a prefilled GitHub Discussions Ideas post', () => {
    render(<BetaPage />)
    const ideaLink = screen.getByRole('link', { name: /share an idea on github/i })
    const href = ideaLink.getAttribute('href') ?? ''
    expect(href).toMatch(/^https:\/\/github\.com\/lbragile\/TabMerger\/discussions\/new\?/)
    expect(href).toMatch(/category=ideas/)
  })

  it('shows the plain GitHub Discussions link so testers can browse existing reports', () => {
    render(<BetaPage />)
    const discussionsLink = screen.getByRole('link', { name: /github\.com\/lbragile\/TabMerger\/discussions/i })
    expect(discussionsLink).toHaveAttribute('href', 'https://github.com/lbragile/TabMerger/discussions')
  })

  it('offers a single contact form fallback for testers without a GitHub account', () => {
    render(<BetaPage />)
    const fallbackLinks = screen.getAllByRole('link', { name: /no github account\? use the contact form/i })
    expect(fallbackLinks).toHaveLength(1)
    expect(fallbackLinks[0]).toHaveAttribute('href', '/contact?topic=beta')
  })

  it('shows the bug report and idea buttons side by side in one row', () => {
    render(<BetaPage />)
    const bugLink = screen.getByRole('link', { name: /report a bug on github/i })
    const ideaLink = screen.getByRole('link', { name: /share an idea on github/i })
    // Both buttons' anchor elements share the same immediate row container.
    expect(bugLink.parentElement).toBe(ideaLink.parentElement)
  })

  it('warns that GitHub Discussions are public', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(/discussions are public/i)
  })

  it('renders the join/install, what-to-test, report-bugs, and FAQ sections', () => {
    render(<BetaPage />)
    expect(document.getElementById('join')).toBeInTheDocument()
    expect(document.getElementById('what-to-test')).toBeInTheDocument()
    expect(document.getElementById('report-bugs')).toBeInTheDocument()
    expect(document.getElementById('faq')).toBeInTheDocument()
  })

  it('renders a copyable bug report template with all required fields', () => {
    render(<BetaPage />)
    const pre = Array.from(document.querySelectorAll('pre')).find((el) =>
      (el.textContent ?? '').includes('Steps to reproduce:')
    )
    expect(pre).toBeInTheDocument()
    expect(pre?.textContent).toMatch(/Summary:/)
    expect(pre?.textContent).toMatch(/Steps to reproduce:/)
    expect(pre?.textContent).toMatch(/Expected:/)
    expect(pre?.textContent).toMatch(/Actual:/)
    expect(pre?.textContent).toMatch(/Beta version/)
    expect(pre?.textContent).toMatch(/Browser and OS:/)
    expect(pre?.textContent).toMatch(/Signed in:/)
    expect(pre?.textContent).toMatch(/Screenshots or screen recording:/)
  })

  it('does not list AI features as testable', () => {
    render(<BetaPage />)
    expect(document.body.textContent).not.toMatch(/auto-group/i)
    expect(document.body.textContent).toMatch(/hidden \("coming soon"\)/i)
  })


  it('explains which browsers can test the beta and the Edge/Opera install notes', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(
      /Chrome, Edge, Brave, Vivaldi, Arc, and Opera all use this same TabMerger BETA listing/
    )
    expect(document.body.textContent).toMatch(/Allow extensions from other stores/)
    expect(document.body.textContent).toMatch(/Install Chrome Extensions/)
    expect(document.body.textContent).toMatch(/A Firefox beta is coming/)
    expect(document.body.textContent).toMatch(
      /Firefox users can join the beta with any of the supported Chromium browsers/
    )
    expect(
      screen.queryByRole('link', { name: /Firefox Add-ons/ })
    ).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/addons\.mozilla\.org/)
    expect(document.body.textContent).toMatch(/Safari isn't supported/)
  })

  it('answers the "Item not found" FAQ', () => {
    render(<BetaPage />)
    expect(screen.getByRole('heading', { name: /item not found/i })).toBeInTheDocument()
  })

  it('renders test steps as ordered lists', () => {
    render(<BetaPage />)
    const orderedLists = document.querySelectorAll('#what-to-test ol')
    expect(orderedLists.length).toBeGreaterThan(0)
    // Every test-item steps list should have at least one <li>
    const firstList = orderedLists[0]
    expect(firstList.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('renders at least one screenshot with meaningful alt text', () => {
    render(<BetaPage />)
    const images = Array.from(document.querySelectorAll('#what-to-test img'))
    expect(images.length).toBeGreaterThan(0)
    const withAlt = images.filter((img) => (img.getAttribute('alt') ?? '').trim().length > 0)
    expect(withAlt.length).toBeGreaterThan(0)
  })

  it('shows the "Not enabled" hover-preview example matching the real component copy', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(/Not enabled/)
    expect(document.body.textContent).toMatch(/Page images are off\./)
    expect(document.body.textContent).toMatch(/Turn on in Settings\./)
  })

  it('shows the "Save to TabMerger" right-click menu example', () => {
    render(<BetaPage />)
    expect(document.body.textContent).toMatch(/Save to TabMerger/)
  })

  it('covers the drag-and-drop sub-sections: sorting, cross-window, cross-group, multi-item, drop zones, Now Open, cancel, keyboard, persistence', () => {
    render(<BetaPage />)
    const dndSection = document.getElementById('drag-and-drop')
    expect(dndSection).toBeInTheDocument()
    const text = dndSection?.textContent ?? ''
    expect(text).toMatch(/Sorting: tabs within a window/i)
    expect(text).toMatch(/Sorting: windows within a group/i)
    expect(text).toMatch(/Sorting: groups in the sidebar/i)
    expect(text).toMatch(/Cross-window: moving a tab between window cards/i)
    expect(text).toMatch(/Cross-group: dropping a tab onto a sidebar group/i)
    expect(text).toMatch(/Cross-group: dragging a whole window into another group/i)
    expect(text).toMatch(/Multi-item: selecting and dragging several tabs/i)
    expect(text).toMatch(/Multi-item: dragging a selection across windows and groups/i)
    expect(text).toMatch(/Multi-item: select all and multi-group drag/i)
    expect(text).toMatch(/Drop zones: "Drop here for a new window" and "Drop for a new group"/i)
    expect(text).toMatch(/From "Now Open": dragging a live tab into a saved group/i)
    expect(text).toMatch(/Cancel and edge cases/i)
    expect(text).toMatch(/Keyboard drag/i)
    expect(text).toMatch(/Persistence/i)
  })

  it('says Now Open stays pinned first and cannot be dragged above', () => {
    render(<BetaPage />)
    const dndSection = document.getElementById('drag-and-drop')
    expect(dndSection?.textContent).toMatch(/"Now Open" always stays pinned as the first row/i)
  })

  it('says dragging a live "Now Open" tab into a saved group moves (not copies) it', () => {
    render(<BetaPage />)
    const dndSection = document.getElementById('drag-and-drop')
    expect(dndSection?.textContent).toMatch(/This MOVES the tab, not copies it/i)
  })

  it('renders the "Upgrading to Pro (test payments)" section with the Stripe test card', () => {
    render(<BetaPage />)
    const section = document.getElementById('upgrading-to-pro')
    expect(section).toBeInTheDocument()
    expect(section?.textContent).toMatch(/4242 4242 4242 4242/)
  })

  it('warns testers never to enter a real card in the upgrade section', () => {
    render(<BetaPage />)
    const section = document.getElementById('upgrading-to-pro')
    expect(section?.textContent).toMatch(/never enter a real card/i)
    expect(section?.textContent).toMatch(/no real money\s+is charged/i)
  })

  it('no longer tells testers billing is out of scope', () => {
    render(<BetaPage />)
    expect(document.body.textContent).not.toMatch(/billing isn't part of this beta/i)
    expect(document.body.textContent).not.toMatch(/don't try to upgrade from the/i)
  })

  it('says Pro AI stays coming-soon and is not part of the upgrade test', () => {
    render(<BetaPage />)
    const section = document.getElementById('upgrading-to-pro')
    expect(section?.textContent).toMatch(/coming soon/i)
    expect(section?.textContent).toMatch(/not purchasable/i)
  })

  it('answers the "Will I be charged" FAQ with test-mode-only', () => {
    render(<BetaPage />)
    expect(screen.getByRole('heading', { name: /will i be charged/i })).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/uses stripe's test mode/i)
  })

  it('describes search as a substring match with prefixes and jump-to-result, not letters-in-order', () => {
    render(<BetaPage />)
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/plain substring, like "hub"/i)
    expect(text).toMatch(/group:/)
    expect(text).toMatch(/not letters-in-order/i)
    expect(text).toMatch(/jumps you straight to that result/i)
  })

  it('covers the encryption sub-sections: setup, unlock, locked/restart, reset, web dashboard, and the visible signal', () => {
    render(<BetaPage />)
    const section = document.getElementById('encryption')
    expect(section).toBeInTheDocument()
    const text = section?.textContent ?? ''
    expect(text).toMatch(/First-time passphrase setup/i)
    expect(text).toMatch(/Unlocking on a second device/i)
    expect(text).toMatch(/What "locked" looks like, and staying unlocked after a restart/i)
    expect(text).toMatch(/Forgot your passphrase — resetting encryption/i)
    expect(text).toMatch(/Verifying on the web dashboard/i)
    expect(text).toMatch(/How to tell your data really is encrypted/i)
    // Exact UI copy from EncryptionSetup.tsx / PassphrasePrompt.tsx
    expect(text).toMatch(/Wrong passphrase/)
    expect(text).toMatch(/Incorrect passphrase\./)
    expect(text).toMatch(/\(locked\)/)
  })

  it('covers sharing: creating, opening, previews, many windows, dashboard parity, and no revoke/expiry', () => {
    render(<BetaPage />)
    const section = document.getElementById('sharing')
    expect(section).toBeInTheDocument()
    const text = section?.textContent ?? ''
    expect(text).toMatch(/Sharing one or more groups from the extension/i)
    expect(text).toMatch(/Opening a shared link/i)
    expect(text).toMatch(/Page previews on the shared page/i)
    expect(text).toMatch(/Sharing a group with many windows/i)
    expect(text).toMatch(/Sharing from the web dashboard instead of the extension/i)
    expect(text).toMatch(/Editing, re-sharing, revoking, and expiry — what's NOT possible/i)
    expect(text).toMatch(/#key=/)
    expect(text).toMatch(/no UI anywhere to edit, revoke, delete, or expire/i)
  })

  it('covers Settings tab by tab: General, Account, Data, Save/Reset, and the version badge', () => {
    render(<BetaPage />)
    const section = document.getElementById('settings')
    expect(section).toBeInTheDocument()
    const text = section?.textContent ?? ''
    expect(text).toMatch(/General tab — Theme, Confirm before deleting/i)
    expect(text).toMatch(/General tab — Show page images in previews/i)
    expect(text).toMatch(/General tab — Cloud sync, Stale tab threshold, URL rules/i)
    expect(text).toMatch(/Account tab — Plan, Renews, Email/i)
    expect(text).toMatch(/Account tab — Forgot your passphrase\? Reset encryption/i)
    expect(text).toMatch(/Data tab — Export, Import, Clear all data/i)
    expect(text).toMatch(/Save vs Reset, and the "Unsaved changes" indicator/i)
    expect(text).toMatch(/The version badge/i)
  })

  it('says AI and Dev Settings tabs are out of scope for this beta build', () => {
    render(<BetaPage />)
    const section = document.getElementById('settings')
    expect(section?.textContent).toMatch(/AI and Dev tabs are not part of this beta build/i)
  })

  it('adds a "Web app and dashboard" area after sign-in-and-sync covering auth, read-only groups, and the account page', () => {
    render(<BetaPage />)
    const section = document.getElementById('web-app-and-dashboard')
    expect(section).toBeInTheDocument()
    const text = section?.textContent ?? ''
    expect(text).toMatch(/Signing up and signing in/i)
    expect(text).toMatch(/Forgot password and changing your password/i)
    expect(text).toMatch(/Dashboard matches the extension after sync/i)
    expect(text).toMatch(/The dashboard is read-only for groups/i)
    expect(text).toMatch(/Sessions and stats on the dashboard/i)
    expect(text).toMatch(/Sharing from the dashboard/i)
    expect(text).toMatch(/Account page/i)
    expect(text).toMatch(/Continue with Google/i)
    expect(text).toMatch(/Send magic link/i)
  })

  it('places "Web app and dashboard" after "Sign-in and sync" in TEST_AREAS order', () => {
    render(<BetaPage />)
    const details = Array.from(document.querySelectorAll('#what-to-test details'))
    const ids = details.map((d) => d.id)
    const signInIdx = ids.indexOf('sign-in-and-sync')
    const webAppIdx = ids.indexOf('web-app-and-dashboard')
    expect(signInIdx).toBeGreaterThanOrEqual(0)
    expect(webAppIdx).toBe(signInIdx + 1)
  })

  describe('Firefox beta install section', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('shows only a short "coming soon" line when FIREFOX_BETA_BLOB_BASE_URL is unset', () => {
      render(<BetaPage />)
      expect(document.body.textContent).toMatch(/A Firefox beta is coming/)
      expect(document.body.textContent).toMatch(
        /Firefox users can join the beta with any of the supported Chromium browsers/
      )
      expect(screen.queryByRole('link', { name: /install the firefox beta/i })).not.toBeInTheDocument()
    })

    it('shows a real Firefox install section when FIREFOX_BETA_BLOB_BASE_URL is set', async () => {
      vi.stubEnv('FIREFOX_BETA_BLOB_BASE_URL', 'https://abc123.public.blob.vercel-storage.com')
      vi.resetModules()
      const { default: ConfiguredBetaPage } = await import('@/app/(marketing)/beta/page')
      render(<ConfiguredBetaPage />)

      expect(document.body.textContent).not.toMatch(/A Firefox beta is coming/)

      const installLink = screen.getByRole('link', { name: /install the firefox beta/i })
      expect(installLink).toHaveAttribute('href', '/firefox-beta/tabmerger-beta.xpi')

      const text = document.body.textContent ?? ''
      expect(text).toMatch(/TabMerger BETA/)
      expect(text).toMatch(/about:addons/)
      expect(text).toMatch(/Check for Updates/i)
      // Website sign-in only reaches Firefox after the extension's own consent prompt was allowed
      expect(text).toMatch(/sign in once inside the extension and allow Firefox's data permission prompt/i)
      expect(text).toMatch(/after that, signing in on this website also signs the extension in/i)
      expect(text).toMatch(/anyone with the install link.*can install it/i)
      expect(text).toMatch(/don't share it outside the tester group/i)
      // Must never link or mention the stable Firefox add-on (its store version is outdated).
      expect(text).not.toMatch(/addons\.mozilla\.org/)
      expect(text).not.toMatch(/stable Firefox|outdated/i)
      expect(screen.queryByRole('link', { name: /Firefox Add-ons/ })).not.toBeInTheDocument()
    })
  })
})
