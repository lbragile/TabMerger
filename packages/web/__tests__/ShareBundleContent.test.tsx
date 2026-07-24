import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShareBundleContent } from '@/components/ShareBundleContent'

describe('ShareBundleContent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders distinct windows/tabs without duplicate-key React warnings when ids collide at 0', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

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
              tabs: [{ id: 0, title: 'Tab A1', url: 'https://example.com/a1' }],
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
              tabs: [{ id: 0, title: 'Tab B1', url: 'https://example.com/b1' }],
            },
          ],
        },
      ],
    }

    render(<ShareBundleContent bundle={bundle} />)

    expect(screen.getByText('Tab A1')).toBeInTheDocument()
    expect(screen.getByText('Tab B1')).toBeInTheDocument()

    const duplicateKeyWarning = errorSpy.mock.calls.some((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('same key'))
    )
    expect(duplicateKeyWarning).toBe(false)
  })

  it('labels each window with its 1-indexed number and an Incognito badge when applicable', () => {
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
              tabs: [{ id: 0, title: 'Tab A1', url: 'https://example.com/a1' }],
            },
            {
              id: 1,
              incognito: true,
              focused: false,
              tabs: [{ id: 0, title: 'Tab A2', url: 'https://example.com/a2' }],
            },
          ],
        },
      ],
    }

    render(<ShareBundleContent bundle={bundle} />)

    expect(screen.getByText('Window 1')).toBeInTheDocument()
    expect(screen.getByText('Window 2')).toBeInTheDocument()
    expect(screen.getByText('Incognito')).toBeInTheDocument()
  })

  it('shows "Link not found." when bundle is null', () => {
    render(<ShareBundleContent bundle={null} />)
    expect(screen.getByText('Link not found.')).toBeInTheDocument()
  })

  it('shows total tabs/windows/groups summary and per-group counts', () => {
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
                { id: 0, title: 'Tab A1', url: 'https://example.com/a1' },
                { id: 1, title: 'Tab A2', url: 'https://example.com/a2' },
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
              tabs: [{ id: 0, title: 'Tab B1', url: 'https://example.com/b1' }],
            },
          ],
        },
      ],
    }

    render(<ShareBundleContent bundle={bundle} />)

    // 3 windows total (2 in group A, 1 in group B), 4 tabs total, 2 groups
    expect(screen.getByText('4 tabs across 3 windows in 2 groups')).toBeInTheDocument()
    expect(screen.getByText('2 windows · 3 tabs')).toBeInTheDocument()
    expect(screen.getByText('1 windows · 1 tabs')).toBeInTheDocument()
  })
})
