import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BETA_GUIDE_FIREFOX_ID, BETA_STORE_LINKS } from '@/lib/storeLinks'

const { startFile } = vi.hoisted(() => ({ startFile: vi.fn() }))
vi.mock('@/lib/startFile', () => ({ startFile }))

const XPI = '/firefox-beta/tabmerger-beta.xpi'

/** Loads the guide fresh: whether the Firefox beta file exists is read once, at module scope. */
async function renderBetaPage({ configured }: { configured: boolean }) {
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('FIREFOX_BETA_BLOB_BASE_URL', configured ? 'https://placeholder.example' : '')
  vi.resetModules()
  const { default: BetaPage } = await import('@/app/(marketing)/beta/page')
  return render(<BetaPage />)
}

function firefoxStep() {
  return document.getElementById(BETA_GUIDE_FIREFOX_ID) as HTMLElement
}

function address() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

describe('beta guide: arriving from a Firefox install button', () => {
  beforeEach(() => {
    startFile.mockClear()
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('the Firefox install link targets the guide\'s Firefox step', () => {
    expect(BETA_STORE_LINKS.firefox).toBe(`/beta?download=firefox#${BETA_GUIDE_FIREFOX_ID}`)
  })

  it.each([
    ['the beta file is configured', true],
    ['the beta file is not configured', false],
  ])('renders the Firefox step with that id inside "Join and install" when %s', async (_label, configured) => {
    await renderBetaPage({ configured })

    const step = firefoxStep()
    expect(step).not.toBeNull()
    expect(document.querySelectorAll(`#${BETA_GUIDE_FIREFOX_ID}`)).toHaveLength(1)
    // A step of the "Join and install" list, not the section heading or the top of the page.
    expect(step.tagName).toBe('LI')
    expect(step.closest('section')).toHaveAttribute('id', 'join')
    expect(step.textContent).toMatch(/^Firefox\./)
    // Clear of the sticky header when scrolled to.
    expect(step.className).toMatch(/\bscroll-mt-24\b/)
  })

  it('starts the file exactly once when the flag is present and the file is configured', async () => {
    window.history.pushState({}, '', BETA_STORE_LINKS.firefox)
    const view = await renderBetaPage({ configured: true })

    expect(startFile).toHaveBeenCalledTimes(1)
    expect(startFile).toHaveBeenCalledWith(XPI)
    expect(address()).toBe('/beta#firefox')

    // A reload or coming Back renders the guide again, now without the flag.
    view.unmount()
    await renderBetaPage({ configured: true })
    expect(startFile).toHaveBeenCalledTimes(1)
  })

  it('shows the status line in the Firefox step, next to a real link to the file', async () => {
    window.history.pushState({}, '', BETA_STORE_LINKS.firefox)
    await renderBetaPage({ configured: true })

    const step = within(firefoxStep())
    expect(step.getByRole('status')).toHaveTextContent(/If nothing happens, use "Install the Firefox beta" in this step/)
    // One click on this always works, whether or not the automatic start was allowed.
    const link = step.getByRole('link', { name: 'Install the Firefox beta' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', XPI)
    expect(link).not.toHaveAttribute('target')
  })

  it('does not start the file or say anything without the flag', async () => {
    window.history.pushState({}, '', '/beta#firefox')
    await renderBetaPage({ configured: true })

    expect(startFile).not.toHaveBeenCalled()
    expect(within(firefoxStep()).getByRole('status')).toBeEmptyDOMElement()
    expect(within(firefoxStep()).getByRole('link', { name: 'Install the Firefox beta' })).toHaveAttribute('href', XPI)
  })

  it('starts nothing when the file is not configured, and clears the flag', async () => {
    window.history.pushState({}, '', BETA_STORE_LINKS.firefox)
    await renderBetaPage({ configured: false })

    expect(startFile).not.toHaveBeenCalled()
    expect(address()).toBe('/beta#firefox')
    expect(within(firefoxStep()).getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByRole('link', { name: 'Install the Firefox beta' })).not.toBeInTheDocument()
    expect(firefoxStep().textContent).toMatch(/A Firefox beta is coming soon/)
  })

  it('ticks nothing in the tester checklist on arrival', async () => {
    window.localStorage.clear()
    window.history.pushState({}, '', BETA_STORE_LINKS.firefox)
    await renderBetaPage({ configured: true })

    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0)
    expect(window.localStorage.getItem('tabmerger:beta-checklist:v1')).toBeNull()
  })
})
