import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareBundleContent } from '@/components/ShareBundleContent'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  window.localStorage.clear()
})

function makeBundle(tab: Record<string, unknown>, url = 'https://www.github.com/foo') {
  return {
    slug: 'test-slug',
    expiresAt: null,
    groups: [
      {
        id: 'group-a',
        name: 'Group A',
        color: 'rgba(0,0,0,1)',
        windows: [
          {
            id: 0,
            incognito: false,
            focused: false,
            tabs: [{ id: 0, title: 'GitHub', url, ...tab }],
          },
        ],
      },
    ],
  }
}

/** Turns on the "Show page previews" switch and confirms the dialog, as a real viewer would. */
async function enablePreviews(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('switch', { name: /show page previews/i }))
  await user.click(await screen.findByRole('button', { name: /turn on/i }))
}

describe('ShareBundleContent — page previews opt-in', () => {
  it('shows always-visible helper text under the switch', () => {
    render(<ShareBundleContent bundle={makeBundle({})} />)
    expect(
      screen.getByText(/sends that tab's web address to TabMerger's preview service/i)
    ).toBeInTheDocument()
  })

  it('defaults the switch to off and persists nothing until confirmed', () => {
    render(<ShareBundleContent bundle={makeBundle({})} />)
    expect(screen.getByRole('switch', { name: /show page previews/i })).toHaveAttribute('data-state', 'unchecked')
    expect(window.localStorage.getItem('tabmerger-share-previews-enabled')).toBeNull()
  })

  it('does not call og-preview on hover while the switch is off', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={makeBundle({}, 'https://www.github.com/off-by-default')} />)

    await user.hover(screen.getAllByText('GitHub')[0])

    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('turning the switch on opens a confirmation dialog and makes no call until confirmed', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={makeBundle({}, 'https://www.github.com/confirm-flow')} />)

    await user.click(screen.getByRole('switch', { name: /show page previews/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/turn on page previews/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    // Not persisted yet — only "Turn on" flips and saves it.
    expect(window.localStorage.getItem('tabmerger-share-previews-enabled')).toBeNull()
  })

  it('cancelling the dialog keeps the switch off and persists nothing', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={makeBundle({})} />)

    await user.click(screen.getByRole('switch', { name: /show page previews/i }))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    expect(screen.getByRole('switch', { name: /show page previews/i })).toHaveAttribute('data-state', 'unchecked')
    expect(window.localStorage.getItem('tabmerger-share-previews-enabled')).toBeNull()
  })

  it('confirming turns the switch on, persists it, and enables live fetches', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ogImage: 'https://example.com/live-og.png' }),
    })
    const user = userEvent.setup()
    const liveUrl = 'https://www.github.com/live-fetch'
    render(<ShareBundleContent bundle={makeBundle({}, liveUrl)} />)

    await enablePreviews(user)

    expect(screen.getByRole('switch', { name: /show page previews/i })).toHaveAttribute('data-state', 'checked')
    expect(window.localStorage.getItem('tabmerger-share-previews-enabled')).toBe('true')

    await user.hover(screen.getAllByText('GitHub')[0])

    await waitFor(() =>
      expect(
        Array.from(document.body.querySelectorAll('img')).some(
          (img) => (img as HTMLImageElement).src === 'https://example.com/live-og.png'
        )
      ).toBe(true)
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/og-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: liveUrl }),
    })
  })

  it('turning off after being on is immediate, with no confirmation dialog', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={makeBundle({})} />)

    await enablePreviews(user)
    expect(screen.getByRole('switch', { name: /show page previews/i })).toHaveAttribute('data-state', 'checked')

    await user.click(screen.getByRole('switch', { name: /show page previews/i }))

    expect(screen.getByRole('switch', { name: /show page previews/i })).toHaveAttribute('data-state', 'unchecked')
    expect(window.localStorage.getItem('tabmerger-share-previews-enabled')).toBe('false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape dismisses the confirmation dialog and leaves the switch off', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={makeBundle({})} />)

    await user.click(screen.getByRole('switch', { name: /show page previews/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('switch', { name: /show page previews/i })).toHaveAttribute('data-state', 'unchecked')
  })

  it('shows tab title, url, and og image on hover when ogImage is already present, without calling fetch', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={makeBundle({ ogImage: 'https://example.com/og.png' })} />)

    await user.hover(screen.getAllByText('GitHub')[0])

    await waitFor(() =>
      expect(
        Array.from(document.body.querySelectorAll('img')).some(
          (img) => (img as HTMLImageElement).src === 'https://example.com/og.png'
        )
      ).toBe(true)
    )
    expect(screen.queryByText('No preview')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})
