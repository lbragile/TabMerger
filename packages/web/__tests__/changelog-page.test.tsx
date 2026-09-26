import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ChangeEntry } from '@/lib/changelog'

const { getGeneratedChangelog } = vi.hoisted(() => ({ getGeneratedChangelog: vi.fn() }))

// The page reads generated release data from CHANGELOG.md via getGeneratedChangelog()
// at render time. Mock just that function (keep everything else, e.g. types, real) so
// each test controls exactly what "was parsed from CHANGELOG.md" without touching the
// filesystem or module-resolution path logic (that's covered separately in
// changelog-lib.test.ts).
vi.mock('@/lib/changelog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/changelog')>()
  return { ...actual, getGeneratedChangelog }
})

// Import after the mock is registered so ChangelogPage picks up the mocked function.
const { default: ChangelogPage } = await import('@/app/(marketing)/changelog/page')

describe('ChangelogPage', () => {
  beforeEach(() => {
    getGeneratedChangelog.mockReset()
    getGeneratedChangelog.mockReturnValue([])
  })

  // v3.0.0's git tag is only a semantic-release anchor, so CHANGELOG.md never gets a
  // section for it — without the hand-written entry the live version wouldn't be listed.
  it('lists v3.0.0, the live version, even when CHANGELOG.md has no stable entries', () => {
    expect(() => render(<ChangelogPage />)).not.toThrow()
    expect(document.getElementById('v3-0-0')).toBeInTheDocument()
  })

  it('renders heading links pointing to the matching anchor id', () => {
    render(<ChangelogPage />)
    expect(screen.getByRole('link', { name: 'v3.0.0' })).toHaveAttribute('href', '#v3-0-0')
  })

  it('shows the "Major release" badge only for vX.0.0 entries', () => {
    getGeneratedChangelog.mockReturnValue([
      { version: 'v3.1.0', date: 'October 1, 2026', changes: [{ type: 'Fixed', text: 'extension: a fix' }] },
    ])
    render(<ChangelogPage />)
    // v3.0.0, and the original extension's v2.0.0 and v1.0.0.
    expect(screen.getAllByText('Major release')).toHaveLength(3)
    expect(document.getElementById('v1-0-0')?.className).toContain('bg-surface2')
    expect(document.getElementById('v3-0-0')?.className).toContain('bg-surface2')
    expect(document.getElementById('v2-0-0')?.className).toContain('bg-surface2')
    expect(document.getElementById('v1-6-2')?.className).not.toContain('bg-surface2')
    expect(document.getElementById('v3-1-0')?.className).not.toContain('bg-surface2')
  })

  it('renders change-type badges with correct text content', () => {
    getGeneratedChangelog.mockReturnValue([
      { version: 'v3.0.1', date: 'October 1, 2026', changes: [{ type: 'Fixed', text: 'extension: a fix' }] },
    ])
    render(<ChangelogPage />)
    expect(screen.getAllByText('New').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Improved').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fixed').length).toBeGreaterThan(0)
  })

  // The original extension's releases: exactly the tags on github.com/lbragile/TabMerger,
  // newest first, below v3.0.0.
  it('lists every tagged release of the original extension, newest first', () => {
    render(<ChangelogPage />)
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id)
    // Every version Firefox Add-ons lists for TabMerger (its full public version history),
    // plus v1.0.0, which predates the Firefox listing.
    const tagged = [
      'v3-0-0', 'v2-0-0', 'v1-6-2', 'v1-6-1', 'v1-6-0', 'v1-5-0',
      'v1-4-3', 'v1-4-2', 'v1-4-1', 'v1-4-0', 'v1-3-1', 'v1-3-0', 'v1-2-1', 'v1-2-0',
      'v1-1-3', 'v1-1-2', 'v1-1-1', 'v1-1-0', 'v1-0-1', 'v1-0-0',
    ]
    const positions = tagged.map((id) => ids.indexOf(id))
    expect(positions).not.toContain(-1)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  // The page used to list v2.0.1 and v2.1.0 (and a v2.0.0 dated May 2026) that never
  // existed. The real v2.0.0 shipped March 6, 2021.
  it('does not bring back the invented v2.x releases', () => {
    render(<ChangelogPage />)
    expect(document.getElementById('v2-1-0')).not.toBeInTheDocument()
    expect(document.getElementById('v2-0-1')).not.toBeInTheDocument()
    expect(document.getElementById('v2-0-0')).toHaveTextContent('March 6, 2021')
    expect(document.body.textContent).not.toMatch(/May 4, 2026|June 12, 2026|July 28, 2026/)
  })


  it('places generated releases above v3.0.0', () => {
    getGeneratedChangelog.mockReturnValue([
      { version: 'v3.1.0', date: 'October 1, 2026', changes: [{ type: 'New', text: 'extension: something new' }] },
    ])
    render(<ChangelogPage />)
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id)
    expect(ids.indexOf('v3-1-0')).toBeLessThan(ids.indexOf('v3-0-0'))
  })

  it('does not advertise AI features in v3.0.0 while they are marked "coming soon"', () => {
    render(<ChangelogPage />)
    const v3 = document.getElementById('v3-0-0')
    expect(v3?.textContent).not.toMatch(/\bAI\b/)
  })

  it('renders generated CHANGELOG.md entries in order, newest first', () => {
    const generated: ChangeEntry[] = [
      { version: 'v3.2.0', date: 'November 1, 2026', changes: [{ type: 'New', text: 'popup: newer thing' }] },
      { version: 'v3.1.0', date: 'October 1, 2026', changes: [{ type: 'New', text: 'popup: add drag and drop reordering' }] },
    ]
    getGeneratedChangelog.mockReturnValue(generated)
    render(<ChangelogPage />)

    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id)
    expect(ids.indexOf('v3-2-0')).toBeLessThan(ids.indexOf('v3-1-0'))
    expect(ids.indexOf('v3-1-0')).toBeLessThan(ids.indexOf('v3-0-0'))
  })

  it('filters out prerelease entries end-to-end so only stable versions from CHANGELOG.md reach the page', async () => {
    // Runs real parseChangelog() (not mocked) against fixture markdown shaped like what
    // semantic-release's release-notes-generator produces, so this exercises the actual
    // filtering logic rather than a hand-picked ChangeEntry.
    const actual = await vi.importActual<typeof import('@/lib/changelog')>('@/lib/changelog')
    const raw = `# [2.2.0](https://github.com/o/r/compare/v2.1.0...v2.2.0) (2026-10-01)

### Features

* add stable thing ([abc1234](https://github.com/o/r/commit/abc1234))

# [2.2.0-beta.1](https://github.com/o/r/compare/v2.1.0...v2.2.0-beta.1) (2026-09-25)

### Features

* add beta-only thing ([def5678](https://github.com/o/r/commit/def5678))
`
    getGeneratedChangelog.mockReturnValue(actual.parseChangelog(raw))
    render(<ChangelogPage />)

    expect(document.getElementById('v2-2-0')).toBeInTheDocument()
    expect(document.getElementById('v2-2-0-beta-1')).not.toBeInTheDocument()
    expect(screen.getByText('add stable thing')).toBeInTheDocument()
    expect(screen.queryByText('add beta-only thing')).not.toBeInTheDocument()
  })
})
