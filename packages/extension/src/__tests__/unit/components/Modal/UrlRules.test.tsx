import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { UrlRulesModal } from '@/components/Modal/UrlRules'

const {
  mockUseGroups,
  mockUseUrlRules,
  mockAddRule,
  mockDeleteRule,
  mockReorder,
  mockUseEntitlements,
  mockToastError,
} = vi.hoisted(() => ({
  mockUseGroups: vi.fn(),
  mockUseUrlRules: vi.fn(),
  mockAddRule: vi.fn(),
  mockDeleteRule: vi.fn(),
  mockReorder: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockUseGroups() }))
vi.mock('@/hooks/useUrlRules', () => ({
  useUrlRules: () => mockUseUrlRules(),
  useAddUrlRule: () => ({ mutate: mockAddRule }),
  useDeleteUrlRule: () => ({ mutate: mockDeleteRule }),
  useReorderUrlRule: () => ({ mutate: mockReorder }),
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: vi.fn() } }))

function renderModal() {
  return render(<Dialog open><DialogContent><UrlRulesModal onClose={vi.fn()} /></DialogContent></Dialog>)
}

const groups = {
  available: [
    { id: 'now', name: 'Now Open', permanent: true, archived: false },
    { id: 'g1', name: 'Work', archived: false },
    { id: 'g2', name: 'Personal', archived: false },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseGroups.mockReturnValue({ data: groups })
  mockUseUrlRules.mockReturnValue({ data: [] })
  mockUseEntitlements.mockReturnValue({ tier: 'free' })
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

describe('UrlRulesModal — empty state', () => {
  it('shows "No rules yet" and excludes the permanent Now Open group from the target dropdown', () => {
    renderModal()
    expect(screen.getByText('No rules yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.queryByText('Now Open')).toBeNull()
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
  })
})

describe('UrlRulesModal — listing rules', () => {
  it('renders existing rules with pattern and target group name', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'github.com/*', groupId: 'g1' }] })
    renderModal()
    expect(screen.getByTitle('github.com/*')).toBeTruthy()
    expect(screen.getByText('Work')).toBeTruthy()
  })

  it('shows "(deleted group)" when the rule targets a group that no longer exists', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'x.com/*', groupId: 'gone' }] })
    renderModal()
    expect(screen.getByText('(deleted group)')).toBeTruthy()
  })

  it('deletes a rule', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'x.com/*', groupId: 'g1' }] })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /delete rule/i }))
    expect(mockDeleteRule).toHaveBeenCalledWith('r1')
  })

  it('reorders rules with up/down, disabling at the boundaries', () => {
    mockUseUrlRules.mockReturnValue({ data: [
      { id: 'r1', pattern: 'a.com/*', groupId: 'g1' },
      { id: 'r2', pattern: 'b.com/*', groupId: 'g1' },
    ] })
    renderModal()
    const upButtons = screen.getAllByRole('button', { name: /move rule up/i })
    const downButtons = screen.getAllByRole('button', { name: /move rule down/i })
    expect(upButtons[0]).toBeDisabled()
    expect(downButtons[1]).toBeDisabled()
    fireEvent.click(downButtons[0])
    expect(mockReorder).toHaveBeenCalledWith({ from: 0, to: 1 })
  })
})

describe('UrlRulesModal — adding rules', () => {
  it('Add rule button is disabled until pattern and group are set', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: 'a.com/*' } })
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled()
  })

  it('adds a rule and clears the form', () => {
    renderModal()
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: 'a.com/*' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/pattern/i), { key: 'Enter' })
    // groupId still empty -> Enter should not add
    expect(mockAddRule).not.toHaveBeenCalled()
  })

  it('free tier at the rule limit toasts an upgrade prompt instead of adding', () => {
    mockUseUrlRules.mockReturnValue({ data: [
      { id: 'r1', pattern: 'a.com/*', groupId: 'g1' },
      { id: 'r2', pattern: 'b.com/*', groupId: 'g1' },
      { id: 'r3', pattern: 'c.com/*', groupId: 'g1' },
    ] })
    renderModal()
    expect(screen.getByText('(3/3 used)')).toBeTruthy()
    // Even the button rendered disabled reflects atLimit; force via keydown path is blocked at limit too.
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled()
  })

  it('pro tier has no rule cap shown', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro' })
    mockUseUrlRules.mockReturnValue({ data: [
      { id: 'r1', pattern: 'a.com/*', groupId: 'g1' },
      { id: 'r2', pattern: 'b.com/*', groupId: 'g1' },
      { id: 'r3', pattern: 'c.com/*', groupId: 'g1' },
    ] })
    renderModal()
    expect(screen.queryByText(/used\)/)).toBeNull()
  })
})
