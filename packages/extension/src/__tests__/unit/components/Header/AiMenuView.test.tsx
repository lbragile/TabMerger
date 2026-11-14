import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiMenu } from '@/components/Header/AiMenu'
import { GROUP_VIEW, useUIStore } from '@/stores/uiStore'
import type { Group } from '@/lib/types'

const h = vi.hoisted(() => ({ nameArg: vi.fn(), describeArg: vi.fn() }))

vi.mock('@/lib/aiFlag', () => ({ AI_ENABLED: true }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ aiFeatures: true, tier: 'pro_ai', maxGroups: Infinity, maxTabs: Infinity, aiMode: 'managed' }) }))
vi.mock('@/hooks/useAI', () => ({
  useAutoGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrganizeTabs: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => ({ known: false, remaining: 0 }) }))
vi.mock('@/hooks/useAppSettings', () => ({ useAppSettings: () => ({ data: undefined }) }))
vi.mock('@/hooks/useNameGroupAction', () => ({
  useNameGroupAction: (g: unknown) => { h.nameArg(g); return { run: vi.fn(), isPending: false, block: g ? null : 'notSaved' } },
}))
vi.mock('@/hooks/useDescribeGroupAction', () => ({
  useDescribeGroupAction: (g: unknown) => { h.describeArg(g); return { run: vi.fn(), isPending: false } },
}))

const saved: Group = { id: 'saved', name: 'Saved', color: 'rgba(1, 2, 3, 1)', updatedAt: 1, windows: [{ id: 1, tabs: [{ id: 0, title: 'A', url: 'https://a.test/' }], incognito: false, focused: false }] }
const nowOpen: Group = { id: 'now', name: 'Now Open', color: 'rgba(1, 2, 3, 1)', updatedAt: 1, windows: [], permanent: true }
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ data: { active: { id: 'now', index: 0 }, available: [nowOpen, saved] } }),
  useApplyAIGroups: () => ({ mutateAsync: vi.fn() }),
}))

const renderMenu = () => render(<TooltipProvider><AiMenu onQuotaExceeded={vi.fn()} /></TooltipProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ activeGroupIndex: 1, mainView: GROUP_VIEW, mainViewReturnGroupId: null })
})

describe('AiMenu — selected group vs an open read-only view', () => {
  it('works on the group shown in the main panel in the group view', () => {
    renderMenu()
    expect(h.nameArg).toHaveBeenLastCalledWith(saved)
    expect(h.describeArg).toHaveBeenLastCalledWith(saved)
  })

  it.each([
    ['an archived group', { kind: 'archived', groupId: 'x' } as const],
    ['a session', { kind: 'session', sessionId: 's' } as const],
  ])('treats %s being shown as no group selected', (_n, view) => {
    useUIStore.setState({ mainView: view })
    renderMenu()
    expect(h.nameArg).toHaveBeenLastCalledWith(undefined)
    expect(h.describeArg).toHaveBeenLastCalledWith(undefined)
  })
})
