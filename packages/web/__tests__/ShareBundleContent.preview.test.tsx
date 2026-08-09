import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareBundleContent } from '@/components/ShareBundleContent'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
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

describe('ShareBundleContent — hover preview', () => {
  it('shows tab title, url, and og image on hover when ogImage is present', async () => {
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
  })

  it('shows a "No preview" placeholder when ogImage is absent and the live fetch finds nothing', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ogImage: null }),
    })
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={makeBundle({}, 'https://www.github.com/no-preview')} />)

    await user.hover(screen.getAllByText('GitHub')[0])

    await waitFor(() => expect(screen.getAllByText('No preview').length).toBeGreaterThan(0))
  })

  it('lazily fetches /api/og-preview on hover when ogImage is absent, and only once per open', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ogImage: 'https://example.com/live-og.png' }),
    })
    const user = userEvent.setup()
    const liveUrl = 'https://www.github.com/live-fetch'
    render(<ShareBundleContent bundle={makeBundle({}, liveUrl)} />)

    const trigger = screen.getAllByText('GitHub')[0]
    await user.hover(trigger)

    await waitFor(() =>
      expect(
        Array.from(document.body.querySelectorAll('img')).some(
          (img) => (img as HTMLImageElement).src === 'https://example.com/live-og.png'
        )
      ).toBe(true)
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(`/api/og-preview?url=${encodeURIComponent(liveUrl)}`)

    // Re-hovering the same tab should use the client-side cache, not refetch.
    await user.unhover(trigger)
    await user.hover(trigger)
    await waitFor(() =>
      expect(
        Array.from(document.body.querySelectorAll('img')).some(
          (img) => (img as HTMLImageElement).src === 'https://example.com/live-og.png'
        )
      ).toBe(true)
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not call the live fetch when ogImage is already present', async () => {
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
    expect(fetch).not.toHaveBeenCalled()
  })
})
