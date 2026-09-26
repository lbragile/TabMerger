import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareBundleContent } from '@/components/ShareBundleContent'

describe('ShareBundleContent — open all tabs / favicon contrast', () => {
  let openSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const bundle = {
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
            tabs: [
              { id: 0, title: 'Tab A1', url: 'https://example.com/a1', favIconUrl: 'https://example.com/fav1.png' },
              { id: 1, title: 'Tab A2', url: 'https://example.com/a2' },
              { id: 2, title: 'Bad Tab', url: 'not-a-valid-url' },
            ],
          },
          {
            id: 1,
            incognito: false,
            focused: false,
            tabs: [{ id: 0, title: 'Tab A3', url: 'https://example.com/a3' }],
          },
        ],
      },
      {
        id: 'group-b',
        name: 'Group B',
        color: 'rgba(0,0,0,1)',
        windows: [
          {
            id: 0,
            incognito: false,
            focused: false,
            tabs: [],
          },
        ],
      },
    ],
  }

  it('opens all valid tab URLs in a single window when its "Open all tabs" button is clicked', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={bundle} />)

    const openAllButtons = screen.getAllByRole('button', { name: /open all tabs/i })
    // First window block for Group A has 2 valid tabs (a1, a2) out of 3 (bad-tab excluded)
    await user.click(openAllButtons[0])

    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(openSpy).toHaveBeenCalledWith('https://example.com/a1', '_blank')
    expect(openSpy).toHaveBeenCalledWith('https://example.com/a2', '_blank')
  })

  it('opens all valid tab URLs across every window in a group when "Open all windows" is clicked', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={bundle} />)

    const openAllWindowsButtons = screen.getAllByRole('button', { name: /open all windows/i })
    // Group A has 2 windows: window 1 has 2 valid tabs (a1, a2), window 2 has 1 valid tab (a3)
    await user.click(openAllWindowsButtons[0])

    expect(openSpy).toHaveBeenCalledTimes(3)
    expect(openSpy).toHaveBeenCalledWith('https://example.com/a1', '_blank')
    expect(openSpy).toHaveBeenCalledWith('https://example.com/a2', '_blank')
    expect(openSpy).toHaveBeenCalledWith('https://example.com/a3', '_blank')
  })

  it('does not throw and makes no window.open calls for a window/group with zero valid tab URLs', async () => {
    const user = userEvent.setup()
    render(<ShareBundleContent bundle={bundle} />)

    // Group B has a single empty-tabs window — its open buttons use singular labels (1 window) and should be no-ops
    const openTabButtons = screen.getAllByRole('button', { name: /^open (all )?tabs?$/i })
    const openWindowButtons = screen.getAllByRole('button', { name: /^open (all )?windows?$/i })

    // Last window-level button belongs to Group B's empty window
    await expect(user.click(openTabButtons[openTabButtons.length - 1])).resolves.not.toThrow()
    // Last group-level button belongs to Group B (only empty window)
    await expect(user.click(openWindowButtons[openWindowButtons.length - 1])).resolves.not.toThrow()

    expect(openSpy).not.toHaveBeenCalled()
  })

  it('shows the Incognito badge and still opens valid tab URLs for an incognito window', async () => {
    const user = userEvent.setup()
    const incognitoBundle = {
      slug: 'incognito-slug',
      expiresAt: null,
      groups: [
        {
          id: 'group-c',
          name: 'Group C',
          color: 'rgba(0,0,0,1)',
          windows: [
            {
              id: 0,
              incognito: true,
              focused: false,
              tabs: [{ id: 0, title: 'Private Tab', url: 'https://example.com/private' }],
            },
          ],
        },
      ],
    }
    render(<ShareBundleContent bundle={incognitoBundle} />)

    expect(screen.getByText('Incognito')).toBeInTheDocument()

    // Single tab in this window → singular "Open tab" label
    await user.click(screen.getByRole('button', { name: /^open tab$/i }))
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith('https://example.com/private', '_blank')
  })

  it('disables "Open all windows" for a single-window group whose only window has no valid URLs', () => {
    const singleWindowBundle = {
      slug: 'single-window-slug',
      expiresAt: null,
      groups: [
        {
          id: 'group-d',
          name: 'Group D',
          color: 'rgba(0,0,0,1)',
          windows: [
            {
              id: 0,
              incognito: false,
              focused: false,
              tabs: [{ id: 0, title: 'Bad Tab', url: 'not-a-valid-url' }],
            },
          ],
        },
      ],
    }
    render(<ShareBundleContent bundle={singleWindowBundle} />)

    // Single window → singular "Open window"; but 0 valid tab URLs → plural "Open all tabs"
    expect(screen.getByRole('button', { name: /^open window$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^open all tabs$/i })).toBeDisabled()
  })

  // The favicon used to sit in a bordered, filled tile, which looked like a stray box around
  // every icon. It now renders on its own.
  it('shows each favicon on its own, with no bordered or filled box around it', () => {
    render(<ShareBundleContent bundle={bundle} />)

    // Every tab row has one — a real favicon, or the fallback icon when the tab has none.
    const favicons = screen.getAllByAltText('')
    expect(favicons.length).toBeGreaterThan(0)
    for (const favicon of favicons) {
      expect(favicon.className).toMatch(/\bh-4\b/)
      expect(favicon.className).toMatch(/\bw-4\b/)
      const parentClass = favicon.parentElement?.className ?? ''
      expect(parentClass).not.toMatch(/\bborder\b|bg-white|dark:bg-/)
    }
  })
})
