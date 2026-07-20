/**
 * Feature 64 — Multi-group share page (web)
 *
 * Tests a presentational ShareBundleContent component that the server page
 * will render with its fetched data. ALL tests FAIL until the component
 * exists at @/components/ShareBundleContent.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// ponytail: this component doesn't exist yet — import will fail (red phase)
import { ShareBundleContent } from '@/components/ShareBundleContent'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FUTURE_EXPIRY = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
const PAST_EXPIRY = new Date(Date.now() - 1000).toISOString()

const BUNDLE = {
  slug: 'abc123',
  expiresAt: FUTURE_EXPIRY,
  groups: [
    {
      id: 'g1',
      name: 'Work',
      color: 'rgba(59,130,246,1)',
      windows: [
        {
          id: 1,
          tabs: [
            { id: 1, title: 'GitHub', url: 'https://github.com' },
            { id: 2, title: 'Linear', url: 'https://linear.app' },
          ],
          incognito: false,
          focused: false,
        },
      ],
    },
    {
      id: 'g2',
      name: 'Research',
      color: 'rgba(34,197,94,1)',
      windows: [
        {
          id: 2,
          tabs: [
            { id: 3, title: 'MDN CSS Grid', url: 'https://developer.mozilla.org/css-grid' },
          ],
          incognito: false,
          focused: false,
        },
      ],
    },
  ],
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ShareBundleContent — Feature 64 multi-group share page', () => {
  it('renders group names from the snapshot', () => {
    render(<ShareBundleContent bundle={BUNDLE} />)
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
  })

  it('renders tab titles within each group', () => {
    render(<ShareBundleContent bundle={BUNDLE} />)
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Linear')).toBeInTheDocument()
    expect(screen.getByText('MDN CSS Grid')).toBeInTheDocument()
  })

  it('clicking a tab link opens the URL', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<ShareBundleContent bundle={BUNDLE} />)

    const githubLink = screen.getByRole('link', { name: /github/i })
    // Public share page — tabs render as <a target="_blank">
    expect(githubLink).toHaveAttribute('href', 'https://github.com')
    expect(githubLink).toHaveAttribute('target', '_blank')

    openSpy.mockRestore()
  })

  it('shows "Link expired" when expiresAt is in the past', () => {
    render(<ShareBundleContent bundle={{ ...BUNDLE, expiresAt: PAST_EXPIRY }} />)
    expect(screen.getByText(/link expired/i)).toBeInTheDocument()
    // Groups should NOT be rendered when expired
    expect(screen.queryByText('Work')).not.toBeInTheDocument()
  })

  it('shows "Not found" message when bundle is null', () => {
    render(<ShareBundleContent bundle={null} />)
    expect(screen.getByText(/not found/i)).toBeInTheDocument()
  })

  it('renders without requiring authentication (public access)', () => {
    // No auth context provider — should render without throwing
    expect(() => render(<ShareBundleContent bundle={BUNDLE} />)).not.toThrow()
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('shows tab count across all groups', () => {
    render(<ShareBundleContent bundle={BUNDLE} />)
    // 3 tabs total across 2 groups
    expect(screen.getByText(/3 tabs/i)).toBeInTheDocument()
  })

  it('renders without crashing when a group has 0 windows', () => {
    // ponytail: edge case — group saved with empty windows array
    const bundleWithEmptyGroup = {
      ...BUNDLE,
      groups: [...BUNDLE.groups, { id: 'g3', name: 'Empty Group', color: 'rgba(0,0,0,1)', windows: [] }],
    }
    expect(() => render(<ShareBundleContent bundle={bundleWithEmptyGroup} />)).not.toThrow()
    expect(screen.getByText('Empty Group')).toBeInTheDocument()
  })
})
