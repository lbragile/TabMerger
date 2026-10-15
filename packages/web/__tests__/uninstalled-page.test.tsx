/**
 * /uninstalled page and its survey form: reasons from the shared list, the
 * "answer something" rule, the email check, what the form sends (parsed
 * version/browser/channel only), the success and failure states, and the
 * reinstall links picked by browser and channel.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  STORE_LISTING_URL,
  UNINSTALL_SURVEY_API_PATH,
  UNINSTALL_SURVEY_LIMITS,
  UNINSTALL_SURVEY_REASONS,
} from '@tabmerger/shared'
import UninstalledPage, { metadata } from '@/app/(marketing)/uninstalled/page'

type Query = Record<string, string | string[] | undefined>

async function renderPage(query: Query = { v: '3.1.2', b: 'chrome', c: 'stable' }) {
  render(await UninstalledPage({ searchParams: Promise.resolve(query) }))
}

const fetchMock = vi.fn()

function sentBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string)
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('/uninstalled page', () => {
  it('is never indexed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('renders every reason from the shared list as a checkbox inside a labelled group', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'TabMerger was removed' })).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Why did you remove TabMerger?' })
    const boxes = within(group).getAllByRole('checkbox')
    expect(boxes).toHaveLength(UNINSTALL_SURVEY_REASONS.length)
    for (const reason of UNINSTALL_SURVEY_REASONS) {
      expect(within(group).getByRole('checkbox', { name: reason.label })).toBeInTheDocument()
    }
  })

  it('shows a character count tied to the comment box and caps its length', async () => {
    const user = userEvent.setup()
    await renderPage()
    const box = screen.getByLabelText(/anything else you want to tell us/i)
    expect(box).toHaveAttribute('maxLength', String(UNINSTALL_SURVEY_LIMITS.details))
    expect(box).toHaveAccessibleDescription(`0 of ${UNINSTALL_SURVEY_LIMITS.details} characters`)
    await user.type(box, 'Hello')
    expect(screen.getByText(`5 of ${UNINSTALL_SURVEY_LIMITS.details} characters`)).toBeInTheDocument()
  })

  it('requires a reason or some text before sending', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(fetchMock).not.toHaveBeenCalled()
    const error = screen.getByText('Tick a reason or write a few words before sending.')
    expect(screen.getByRole('group', { name: 'Why did you remove TabMerger?' })).toHaveAttribute(
      'aria-describedby',
      error.id
    )
    expect(screen.getByRole('checkbox', { name: UNINSTALL_SURVEY_REASONS[0].label })).toHaveFocus()
  })

  it('rejects a malformed email without sending and ties the error to the field', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('checkbox', { name: UNINSTALL_SURVEY_REASONS[0].label }))
    const email = screen.getByLabelText(/your email/i)
    await user.type(email, 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(expect.stringContaining('does not look like an email address'))
    expect(email).toHaveFocus()
  })

  it('sends the ticked reasons, text, email and the parsed params, then shows the success message', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('checkbox', { name: 'Something did not work' }))
    await user.click(screen.getByRole('checkbox', { name: 'It slowed my browser down' }))
    await user.type(screen.getByLabelText(/anything else you want to tell us/i), '  It froze.  ')
    await user.type(screen.getByLabelText(/your email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: 'Send answer' }))

    expect(fetchMock).toHaveBeenCalledWith(UNINSTALL_SURVEY_API_PATH, expect.objectContaining({ method: 'POST' }))
    expect(sentBody()).toEqual({
      reasons: ['bug', 'slow'],
      details: 'It froze.',
      email: 'user@example.com',
      version: '3.1.2',
      browser: 'chrome',
      channel: 'stable',
      website: '',
    })
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Thanks, this was sent.')
    expect(status).toHaveFocus()
  })

  it('never forwards junk query values', async () => {
    const user = userEvent.setup()
    await renderPage({ v: '<b>1</b>', b: ['chrome', 'firefox'], c: 'nightly', extra: 'x' })
    await user.type(screen.getByLabelText(/anything else you want to tell us/i), 'Bye')
    await user.click(screen.getByRole('button', { name: 'Send answer' }))
    const body = sentBody()
    expect(body.version).toBeUndefined()
    expect(body.browser).toBeUndefined()
    expect(body.channel).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('nightly')
    expect(document.body.textContent).not.toContain('<b>1</b>')
  })

  it('shows a failure with a retry and a contact link, never a fake "sent"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ ok: false }) })
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('checkbox', { name: 'Something else' }))
    await user.click(screen.getByRole('button', { name: 'Send answer' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This was not sent.')
    expect(alert).toHaveFocus()
    expect(within(alert).getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
    expect(screen.queryByText('Thanks, this was sent.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Thanks, this was sent.')).toBeInTheDocument()
  })

  it('treats a network error as a failure and says so on 429', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ ok: false }) })
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('checkbox', { name: 'Something else' }))
    await user.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('check your connection')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/too many answers/i)).toBeInTheDocument()
  })

  it('links to the reinstall listing for the browser it came from', async () => {
    await renderPage({ v: '3.1.2', b: 'firefox', c: 'stable' })
    const links = screen.getAllByRole('link', { name: /^Add TabMerger to/ })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', STORE_LISTING_URL.FIREFOX_STABLE)
  })

  it('links to every store when the browser is unknown', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    await renderPage({})
    expect(screen.getByRole('link', { name: 'Add TabMerger to Chrome' })).toHaveAttribute(
      'href',
      STORE_LISTING_URL.CHROME_STABLE
    )
    expect(screen.getByRole('link', { name: 'Add TabMerger to Firefox' })).toHaveAttribute(
      'href',
      STORE_LISTING_URL.FIREFOX_STABLE
    )
    expect(screen.getByRole('link', { name: 'Add TabMerger to Edge' })).toHaveAttribute(
      'href',
      STORE_LISTING_URL.EDGE_STABLE
    )
  })

  it('says a subscription is not cancelled and points to the account page', async () => {
    await renderPage()
    expect(screen.getByText(/does not cancel a Pro subscription/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'sign in to your account' })).toHaveAttribute('href', '/account')
  })
})
