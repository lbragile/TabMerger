import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionView } from '@/components/SectionView/SessionView'
import { ArchivedGroupView } from '@/components/SectionView/ArchivedGroupView'
import { i18n } from '@/lib/i18n'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group, Session } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() }))
vi.mock('@/hooks/useGroups', () => ({
  useRestoreGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteGroup: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/useSessions', () => ({
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false }),
}))

const g = (id: string): Group => ({
  id, name: `Name ${id}`, color: 'rgba(1, 2, 3, 1)', updatedAt: Date.now(),
  windows: [{ id: 1, tabs: [{ id: 0, title: 'T', url: 'https://t.test/' }], incognito: false, focused: false }],
})
const session = (createdAt: number, groups: Group[]): Session => ({ id: 's', name: 'Snap', createdAt, groups })
const renderView = (s: Session) => render(<TooltipProvider><SessionView session={s} groups={[]} /></TooltipProvider>)

beforeEach(() => useUIStore.setState({ mainView: GROUP_VIEW, mainViewReturnGroupId: null }))
afterEach(async () => {
  cleanup()
  await act(async () => { await i18n.changeLanguage('en') })
})

describe('SessionView', () => {
  it('leaves the year out of the date when the session is from this year', () => {
    const now = new Date()
    const thisYear = new Date(now.getFullYear(), 0, 2, 9, 5).getTime()
    renderView(session(thisYear, [g('a')]))
    expect(screen.getByText(/^Session ◆ /).textContent).not.toContain(String(now.getFullYear()))
  })

  it('includes the year when the session is not from this year', () => {
    renderView(session(new Date(2020, 5, 10, 18, 22).getTime(), [g('a')]))
    expect(screen.getByText(/^Session ◆ /).textContent).toContain('2020')
  })

  it('says so when the session holds no groups', () => {
    renderView(session(Date.now(), []))
    expect(screen.getByText('This session has no groups.')).toBeInTheDocument()
    expect(screen.getByText(/0 Groups ◆ 0 Tabs/)).toBeInTheDocument()
  })
})

describe.each(['he', 'ar', 'fa'])('read-only views render right-to-left in %s', (lng) => {
  it('both views render with their catalog text and bidi-safe names', async () => {
    await act(async () => { await i18n.changeLanguage(lng) })
    const { unmount } = renderView(session(Date.now(), [g('a')]))
    expect(screen.getByTestId('session-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('heading', { level: 3 })).toHaveAttribute('dir', 'auto')
    // translated, not the English fallback
    expect(screen.getByRole('note').textContent).not.toMatch(/snapshot/i)
    unmount()
    render(<TooltipProvider><ArchivedGroupView group={g('b')} groupIndex={1} groups={[g('b')]} /></TooltipProvider>)
    expect(screen.getByTestId('archived-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('dir', 'auto')
    expect(screen.getByRole('note').textContent).not.toMatch(/Read-only/)
    expect(i18n.dir(lng)).toBe('rtl')
  })
})
