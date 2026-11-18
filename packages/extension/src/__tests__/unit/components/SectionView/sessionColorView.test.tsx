import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTO_ITEM_COLORS, colorForId } from '@tabmerger/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group, GroupsState, Session } from '@/lib/types'
import { clearSectionViewStatus, getSectionViewStatus } from '@/lib/sectionViewStatus'

const h = vi.hoisted(() => ({
  sessions: [] as Session[],
  updateColor: vi.fn(),
  cloudSync: true,
  toastError: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined), getSetting: vi.fn() }))
vi.mock('@/hooks/useRecentlyClosed', () => ({ useRecentlyClosed: () => ({ days: [], entries: [], isLoading: false }) }))
vi.mock('@/components/Windows', () => ({ WindowsPanel: () => <div data-testid="windows-panel" /> }))
vi.mock('@/hooks/useGroups', () => ({ useRestoreGroup: () => ({ mutate: vi.fn() }), useDeleteGroup: () => ({ mutate: vi.fn() }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ cloudSync: h.cloudSync }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: h.toastError, success: vi.fn() } }))
vi.mock('@/hooks/useSessions', () => ({
  useSessions: () => ({ data: h.sessions }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSessionColor: () => ({ mutate: h.updateColor }),
}))

import { MainPanel } from '@/components/SectionView/MainPanel'

const nowOpen: Group = { id: 'now', name: 'Now Open', color: 'c', updatedAt: 1, windows: [], permanent: true }
const groupsState: GroupsState = { active: { id: 'now', index: 0 }, available: [nowOpen] }
const session = (extra: Partial<Session> = {}): Session => ({ id: 's1', name: 'Work week', groups: [], createdAt: Date.now(), ...extra })

const renderView = () => render(<TooltipProvider><MainPanel groupsState={groupsState} /></TooltipProvider>)
const open = () => act(() => useUIStore.getState().openMainView({ kind: 'session', sessionId: 's1' }, 'now'))
/** The header's colour tile (the aria-hidden bookmark tile before the title), and the colour it is drawn in. */
const dot = () => screen.getByRole('heading', { level: 2 }).parentElement!.previousElementSibling as HTMLElement
const tileColor = () => dot().style.getPropertyValue('--item-color')

beforeEach(() => {
  vi.clearAllMocks()
  clearSectionViewStatus()
  h.cloudSync = true
  useUIStore.setState({ activeGroupIndex: 0, mainView: GROUP_VIEW, mainViewReturnGroupId: null })
})

describe('session view colour', () => {
  it('shows the stored colour as the header tile', () => {
    h.sessions = [session({ color: AUTO_ITEM_COLORS[5] })]
    renderView()
    open()
    expect(dot()).toHaveAttribute('data-session-tile')
    expect(tileColor()).toBe(AUTO_ITEM_COLORS[5])
  })

  it('a session saved before colours shows the stable colour of its id', () => {
    h.sessions = [session()]
    renderView()
    open()
    expect(tileColor()).toBe(colorForId('s1'))
  })

  it('⋯ → Change color… lists the ten colours with the current one checked, and picking one saves it', async () => {
    h.sessions = [session({ color: AUTO_ITEM_COLORS[0] })]
    const user = userEvent.setup()
    renderView()
    open()
    await user.click(screen.getByRole('button', { name: 'More options for Work week' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Change color…' }))
    await user.keyboard('{ArrowRight}')
    const radios = await screen.findAllByRole('menuitemradio')
    expect(radios).toHaveLength(10)
    expect(screen.getByRole('menuitemradio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Teal' }))
    expect(h.updateColor).toHaveBeenCalledWith({ id: 's1', color: AUTO_ITEM_COLORS[9], cloudSync: true }, expect.anything())
    const { onSuccess, onError } = h.updateColor.mock.calls[0][1]
    act(() => onSuccess())
    expect(getSectionViewStatus()).toBe('Changed the color of Work week')
    onError()
    expect(h.toastError).toHaveBeenCalledWith("Couldn't change the color. Try again.")
  })

  it('picking the colour it already has does nothing', async () => {
    h.sessions = [session({ color: AUTO_ITEM_COLORS[0] })]
    const user = userEvent.setup()
    renderView()
    open()
    await user.click(screen.getByRole('button', { name: 'More options for Work week' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Change color…' }))
    await user.keyboard('{ArrowRight}')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Red' }))
    expect(h.updateColor).not.toHaveBeenCalled()
  })

  it('a Free account changes it locally only (cloudSync false)', async () => {
    h.cloudSync = false
    h.sessions = [session({ color: AUTO_ITEM_COLORS[0] })]
    const user = userEvent.setup()
    renderView()
    open()
    await user.click(screen.getByRole('button', { name: 'More options for Work week' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Change color…' }))
    await user.keyboard('{ArrowRight}')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Blue' }))
    expect(h.updateColor).toHaveBeenCalledWith({ id: 's1', color: AUTO_ITEM_COLORS[5], cloudSync: false }, expect.anything())
  })
})
