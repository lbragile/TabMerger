import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AUTO_ITEM_COLORS, colorForId } from '@tabmerger/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Session } from '@/lib/types'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import { SIDEBAR_SECTION } from '@/lib/sidebarSections'

const h = vi.hoisted(() => ({ save: vi.fn(), openModal: vi.fn() }))

vi.mock('@/lib/localDb', () => ({ setSetting: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ sessions: true, cloudSync: false }) }))
vi.mock('@/hooks/useSessions', () => ({
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useSaveSession: () => ({ mutateAsync: h.save }),
  useRestoreSession: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SessionsSection } from '@/components/SidePanel/SessionsSection'

const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: `Session ${id}`, groups: [], createdAt: Date.now(), ...extra })

function renderSection(sessions: Session[]) {
  return render(
    <TooltipProvider>
      <SessionsSection groups={[]} sessions={sessions} />
    </TooltipProvider>
  )
}

/** Opens Save session and returns the dialog's `onSave`. */
async function saveCallback(): Promise<(name: string, description?: string, color?: string) => Promise<void>> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Save current session' }))
  const [type, data] = h.openModal.mock.calls.at(-1)!
  expect(type).toBe('saveSession')
  return (data as { onSave: (name: string, description?: string, color?: string) => Promise<void> }).onSave
}

beforeEach(() => {
  vi.clearAllMocks()
  h.save.mockResolvedValue({})
  useUIStore.setState({ openSidebarSection: SIDEBAR_SECTION.sessions, mainView: GROUP_VIEW, selectionMode: false, openModal: h.openModal })
})
afterEach(() => vi.restoreAllMocks())

describe('SessionsSection colours', () => {
  it("each row's start bar is the session's colour, or its id's stable colour", () => {
    renderSection([session('a', { color: AUTO_ITEM_COLORS[5] }), session('b')])
    const rows = screen.getAllByRole('listitem')
    expect(rows[0].style.borderInlineStart).toBe(`3px solid ${AUTO_ITEM_COLORS[5]}`)
    expect(rows[1].style.borderInlineStart).toBe(`3px solid ${colorForId('b')}`)
  })

  it('Save with a picked colour saves that colour', async () => {
    renderSection([session('a', { color: AUTO_ITEM_COLORS[0] })])
    const onSave = await saveCallback()
    await act(() => onSave('New', undefined, AUTO_ITEM_COLORS[3]))
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', color: AUTO_ITEM_COLORS[3] }))
  })

  it("Random never repeats the most recent session's colour", async () => {
    renderSection([session('newest', { color: AUTO_ITEM_COLORS[0] }), session('older', { color: AUTO_ITEM_COLORS[1] })])
    const onSave = await saveCallback()
    for (const r of [0, 0.05, 0.5, 0.99]) {
      vi.spyOn(Math, 'random').mockReturnValue(r)
      await act(() => onSave('New'))
      const color = h.save.mock.calls.at(-1)![0].color
      expect(AUTO_ITEM_COLORS).toContain(color)
      expect(color).not.toBe(AUTO_ITEM_COLORS[0])
    }
  })

  it('Random for the first session picks any palette colour', async () => {
    renderSection([])
    const onSave = await saveCallback()
    await act(() => onSave('First'))
    expect(AUTO_ITEM_COLORS).toContain(h.save.mock.calls[0][0].color)
  })
})
