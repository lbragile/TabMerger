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

  it('renders anchor ids derived from the legacy version numbers when CHANGELOG.md has no generated entries', () => {
    render(<ChangelogPage />)
    expect(document.getElementById('v2-1-0')).toBeInTheDocument()
    expect(document.getElementById('v2-0-1')).toBeInTheDocument()
    expect(document.getElementById('v2-0-0')).toBeInTheDocument()
  })

  it('renders heading links pointing to the matching anchor id', () => {
    render(<ChangelogPage />)
    const link = screen.getByRole('link', { name: 'v2.1.0' })
    expect(link).toHaveAttribute('href', '#v2-1-0')
  })

  it('shows the "Major release" badge only for vX.0.0 entries', () => {
    render(<ChangelogPage />)
    expect(screen.getAllByText('Major release')).toHaveLength(1)
    const majorEntry = document.getElementById('v2-0-0')
    expect(majorEntry).not.toBeNull()
    expect(majorEntry?.className).toContain('bg-surface2')

    const minorEntry = document.getElementById('v2-1-0')
    expect(minorEntry?.className).not.toContain('bg-surface2')
    const patchEntry = document.getElementById('v2-0-1')
    expect(patchEntry?.className).not.toContain('bg-surface2')
  })

  it('renders change-type badges with correct text content', () => {
    render(<ChangelogPage />)
    expect(screen.getAllByText('New').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Improved').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fixed').length).toBeGreaterThan(0)
  })

  it('renders correctly and falls back to legacy-only history when CHANGELOG.md is absent', () => {
    // getGeneratedChangelog() returns [] when CHANGELOG.md doesn't exist yet — the page
    // must not error out and must still show the pre-automation legacy entries.
    getGeneratedChangelog.mockReturnValue([])
    expect(() => render(<ChangelogPage />)).not.toThrow()
    expect(document.getElementById('v2-0-0')).toBeInTheDocument()
    expect(document.getElementById('v2-0-1')).toBeInTheDocument()
    expect(document.getElementById('v2-1-0')).toBeInTheDocument()
  })

  it('renders generated CHANGELOG.md entries ahead of the legacy history', () => {
    const generated: ChangeEntry[] = [
      {
        version: 'v2.2.0',
        date: 'October 1, 2026',
        changes: [{ type: 'New', text: 'popup: add drag and drop reordering' }],
      },
    ]
    getGeneratedChangelog.mockReturnValue(generated)
    render(<ChangelogPage />)

    expect(document.getElementById('v2-2-0')).toBeInTheDocument()
    // Legacy history is still present, rendered after the generated entry.
    expect(document.getElementById('v2-1-0')).toBeInTheDocument()

    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id)
    expect(ids.indexOf('v2-2-0')).toBeLessThan(ids.indexOf('v2-1-0'))
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
