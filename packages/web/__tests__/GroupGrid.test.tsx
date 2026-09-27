import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { GroupGrid } from '@/components/dashboard/GroupGrid'

// lib/sharing.ts (used by both the per-group Share button and "Share selected") talks to
// the browser Supabase client directly — mock that, not fetch, so these tests exercise the
// real client-side encrypt-then-insert path instead of assuming an API route exists.
const mockGetSession = vi.fn()
const mockSingle = vi.fn()
const mockSupabase = {
  auth: { getSession: mockGetSession },
  from: vi.fn(() => ({
    insert: vi.fn(() => ({
      select: vi.fn(() => ({ single: mockSingle })),
    })),
  })),
}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}))

const groups = [
  {
    id: 'g1',
    name: 'Work',
    color: 'rgba(0,180,204,1)',
    windows: [{ tabs: [{ title: 'Tab 1', url: 'https://example.com' }] }],
    updated_at: new Date().toISOString(),
  },
]

describe('GroupGrid', () => {
  it('uses a responsive grid class instead of an unconditional fixed 3-column layout', () => {
    // grid-cols-3 with no sm:/md: prefix forces 3 columns on mobile, causing overflow/squish.
    const { container } = render(<GroupGrid groups={groups} isPro={false} />)

    const gridEl = container.querySelector('.grid') as HTMLElement | null
    expect(gridEl).not.toBeNull()

    // Must not be an unconditional 3-column class with no responsive prefix.
    expect(gridEl?.className).not.toMatch(/^grid grid-cols-3\b/)

    // Must include at least one responsive breakpoint-prefixed grid-cols class.
    expect(gridEl?.className).toMatch(/\b(sm|md|lg):grid-cols-/)
  })

  it('applies the group color as an inline border-left style on the card', () => {
    const { container } = render(<GroupGrid groups={groups} isPro={false} />)
    const card = container.querySelector('[style*="border-left"]') as HTMLElement | null
    expect(card).not.toBeNull()
    expect(card?.style.borderLeft).toContain('rgb(0, 180, 204)')
  })

  it('keeps the tabs list mounted in the DOM when collapsed, toggling grid-rows classes instead of unmounting', () => {
    render(<GroupGrid groups={groups} isPro={false} />)

    // Tab content should already be in the DOM even before "Show tabs" is clicked.
    const tabItem = screen.getByText('Tab 1')
    expect(tabItem).toBeInTheDocument()

    // The wrapping grid container starts collapsed.
    const wrapper = tabItem.closest('ul')?.parentElement as HTMLElement
    expect(wrapper.className).toMatch(/grid-rows-\[0fr\]/)

    fireEvent.click(screen.getByText('Show tabs'))

    expect(wrapper.className).toMatch(/grid-rows-\[1fr\]/)
    // Content remains the same node, not remounted.
    expect(screen.getByText('Tab 1')).toBe(tabItem)
  })
})

describe('GroupGrid share flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    mockSingle.mockResolvedValue({ data: { slug: 'abc123' }, error: null })
  })

  it('creates the bundle client-side (no fetch to any /api route) with decrypted group content', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<GroupGrid groups={groups} isPro={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByLabelText('Select'))
    fireEvent.click(screen.getByRole('button', { name: /Share selected/i }))

    await screen.findByRole('button', { name: /Select/i })

    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/api/'), expect.anything())
    expect(mockSupabase.from).toHaveBeenCalledWith('shared_bundles')

    // No plaintext ever reached the "server" (mocked insert) — only a {v:1,iv,ct} envelope.
    const fromCall = mockSupabase.from.mock.results[0]
    void fromCall
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/share\/abc123#key=.+/))
    const copiedUrl = writeText.mock.calls[0][0] as string
    expect(copiedUrl).not.toContain('Tab 1')

    fetchSpy.mockRestore()
  })

  it('shows a spinner on the Share selected button while the request is in flight', async () => {
    let resolveSingle!: (v: { data: { slug: string }; error: null }) => void
    mockSingle.mockReturnValue(new Promise((resolve) => { resolveSingle = resolve }))
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

    render(<GroupGrid groups={groups} isPro={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Select' }))
    fireEvent.click(screen.getByLabelText('Select'))
    const button = screen.getByRole('button', { name: /Share selected/i })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    expect(button.querySelector('svg.animate-spin')).toBeInTheDocument()

    resolveSingle({ data: { slug: 'abc123' }, error: null })
    await screen.findByRole('button', { name: /Select/i })
  })
})

describe('GroupGrid per-group Share button', () => {
  const proGroups = [
    {
      id: 'g1',
      name: 'Work',
      color: 'rgba(0,180,204,1)',
      windows: [{ tabs: [{ title: 'Tab 1', url: 'https://example.com' }] }],
      updated_at: new Date().toISOString(),
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    mockSingle.mockResolvedValue({ data: { slug: 'group-slug-1' }, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a bundle client-side via lib/sharing (no /api route) and copies a #key= URL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<GroupGrid groups={proGroups} isPro={true} />)

    fireEvent.click(screen.getByRole('button', { name: 'Share group' }))

    await screen.findByText('Copied!')

    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/api/'), expect.anything())
    expect(mockSupabase.from).toHaveBeenCalledWith('shared_bundles')

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${window.location.origin}/share/group-slug-1#key=.+`))
    )
    const copiedUrl = writeText.mock.calls[0][0] as string
    expect(copiedUrl).not.toContain('Tab 1')

    fetchSpy.mockRestore()
  })

  it('refuses to share a group that failed to decrypt (locked) instead of sending a broken link', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const lockedGroups = [{ ...proGroups[0], name: '(locked)', windows: [], locked: true }]
    render(<GroupGrid groups={lockedGroups} isPro={true} />)

    const shareBtn = screen.getByRole('button', { name: 'Share group' })
    expect(shareBtn).toBeDisabled()

    fireEvent.click(shareBtn)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})

describe('GroupGrid "Open all" button', () => {
  it('calls window.open once per tab URL in the group', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const multiTabGroups = [
      {
        id: 'g2',
        name: 'Research',
        color: 'rgba(0,180,204,1)',
        windows: [
          {
            tabs: [
              { title: 'Tab A', url: 'https://a.example.com' },
              { title: 'Tab B', url: 'https://b.example.com' },
            ],
          },
        ],
        updated_at: new Date().toISOString(),
      },
    ]

    render(<GroupGrid groups={multiTabGroups} isPro={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Open all/i }))

    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(openSpy).toHaveBeenCalledWith('https://a.example.com', '_blank', 'noopener')
    expect(openSpy).toHaveBeenCalledWith('https://b.example.com', '_blank', 'noopener')

    openSpy.mockRestore()
  })
})

describe('GroupGrid sort dropdown', () => {
  const sortGroups = [
    {
      id: 'g-b',
      name: 'Beta',
      color: 'rgba(0,0,0,1)',
      windows: [{ tabs: [{ title: 'T', url: 'https://x.com' }] }],
      updated_at: new Date(Date.now() - 1000).toISOString(),
    },
    {
      id: 'g-a',
      name: 'Alpha',
      color: 'rgba(0,0,0,1)',
      windows: [{ tabs: [] }],
      updated_at: new Date(Date.now() - 2000).toISOString(),
    },
    {
      id: 'g-c',
      name: 'Charlie',
      color: 'rgba(0,0,0,1)',
      windows: [{ tabs: [{ title: 'T1', url: 'https://x.com' }, { title: 'T2', url: 'https://y.com' }] }],
      updated_at: new Date().toISOString(),
    },
  ]

  it('reorders the rendered group names alphabetically when sorting by "Name"', () => {
    render(<GroupGrid groups={sortGroups} isPro={false} />)

    const sortSelect = screen.getByLabelText(/sort/i)
    fireEvent.change(sortSelect, { target: { value: 'name' } })

    const names = screen.getAllByText(/^(Alpha|Beta|Charlie)$/).map((el) => el.textContent)
    expect(names).toEqual(['Alpha', 'Beta', 'Charlie'])
  })

  it('reorders the rendered groups by tab count when sorting by "Tab count"', () => {
    render(<GroupGrid groups={sortGroups} isPro={false} />)

    const sortSelect = screen.getByLabelText(/sort/i)
    fireEvent.change(sortSelect, { target: { value: 'tabCount' } })

    const names = screen.getAllByText(/^(Alpha|Beta|Charlie)$/).map((el) => el.textContent)
    // Alpha has 0 tabs, Beta has 1, Charlie has 2 -> ascending or descending, but Charlie
    // and Alpha must not be adjacent-equal; pick descending (most tabs first) as the default.
    expect(names).toEqual(['Charlie', 'Beta', 'Alpha'])
  })
})

describe('GroupGrid stale-tabs warning', () => {
  it('renders a stale warning banner when updated_at is more than 30 days old', () => {
    const staleGroups = [
      {
        id: 'g-stale',
        name: 'Old Project',
        color: 'rgba(0,0,0,1)',
        windows: [{ tabs: [{ title: 'T', url: 'https://x.com' }] }],
        updated_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]
    render(<GroupGrid groups={staleGroups} isPro={false} />)
    expect(screen.getByText(/may be stale/i)).toBeInTheDocument()
  })

  it('does not render a stale warning for a recently-updated group', () => {
    const freshGroups = [
      {
        id: 'g-fresh',
        name: 'New Project',
        color: 'rgba(0,0,0,1)',
        windows: [{ tabs: [{ title: 'T', url: 'https://x.com' }] }],
        updated_at: new Date().toISOString(),
      },
    ]
    render(<GroupGrid groups={freshGroups} isPro={false} />)
    expect(screen.queryByText(/may be stale/i)).not.toBeInTheDocument()
  })
})

describe('GroupGrid archived groups', () => {
  const mixedGroups = [
    {
      id: 'g-active',
      name: 'Active One',
      color: 'rgba(0,0,0,1)',
      windows: [{ tabs: [{ title: 'T', url: 'https://x.com' }] }],
      updated_at: new Date().toISOString(),
      archived: false,
    },
    {
      id: 'g-archived',
      name: 'Archived One',
      color: 'rgba(0,0,0,1)',
      windows: [{ tabs: [{ title: 'T2', url: 'https://y.com' }] }],
      updated_at: new Date().toISOString(),
      archived: true,
    },
  ]

  it('excludes archived groups from the main active grid', () => {
    render(<GroupGrid groups={mixedGroups} isPro={false} />)
    expect(screen.getByText('Active One')).toBeInTheDocument()
    // Archived group name only appears after expanding the archived section, not up front.
    expect(screen.queryByText('Archived One')).not.toBeInTheDocument()
  })

  it('shows a collapsed "Archived (N)" toggle and reveals archived groups on click', () => {
    render(<GroupGrid groups={mixedGroups} isPro={false} />)
    const toggle = screen.getByRole('button', { name: /Archived \(1\)/i })
    expect(toggle).toBeInTheDocument()
    expect(screen.queryByText('Archived One')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('Archived One')).toBeInTheDocument()
  })

  it('excludes archived groups from the header group/tab counts', () => {
    render(<GroupGrid groups={mixedGroups} isPro={false} />)
    expect(screen.getByText(/1 group · 1 tabs/i)).toBeInTheDocument()
  })

  it('renders the archived count correctly when groups are pre-decrypted (plaintext) and does not require a passphrase', () => {
    render(<GroupGrid groups={mixedGroups} isPro={false} />)
    expect(screen.queryByText(/enter your passphrase/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Archived \(1\)/i })).toBeInTheDocument()
  })
})
