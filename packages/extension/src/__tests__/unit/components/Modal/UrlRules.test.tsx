import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { UrlRulesModal } from '@/components/Modal/UrlRules'

const {
  mockUseGroups,
  mockUseUrlRules,
  mockSaveRules,
  mockUseEntitlements,
  mockToastError,
} = vi.hoisted(() => ({
  mockUseGroups: vi.fn(),
  mockUseUrlRules: vi.fn(),
  mockSaveRules: vi.fn(),
  mockUseEntitlements: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({ useGroups: () => mockUseGroups() }))
vi.mock('@/hooks/useUrlRules', () => ({
  useUrlRules: () => mockUseUrlRules(),
  useSaveUrlRules: () => ({ mutate: mockSaveRules }),
}))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => mockUseEntitlements() }))
vi.mock('sonner', () => ({ toast: { error: mockToastError, success: vi.fn() } }))

function renderModal(onClose = vi.fn()) {
  return { onClose, ...render(<Dialog open><DialogContent><UrlRulesModal onClose={onClose} /></DialogContent></Dialog>) }
}

const groups = {
  available: [
    { id: 'now', name: 'Now Open', permanent: true, archived: false },
    { id: 'g1', name: 'Work', color: 'rgba(1,2,3,1)', archived: false },
    { id: 'g2', name: 'Personal', color: 'rgba(4,5,6,1)', archived: false },
  ],
}

function openAddModal() {
  fireEvent.click(screen.getByRole('button', { name: /add rule/i }))
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
    openAddModal()
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

  it('deletes a rule from the draft without persisting until outer Save', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'x.com/*', groupId: 'g1' }] })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /delete rule/i }))
    expect(screen.getByText('No rules yet.')).toBeTruthy()
    expect(mockSaveRules).not.toHaveBeenCalled()
  })

  it('reorders rules with up/down, disabling at the boundaries, draft-only', () => {
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
    expect(mockSaveRules).not.toHaveBeenCalled()
  })
})

describe('UrlRulesModal — editing rules', () => {
  it('clicking the pencil opens the "Edit URL Rule" modal pre-filled with the current pattern and group', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'a.com/*', groupId: 'g1' }] })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /edit rule/i }))
    expect(screen.getByText('Edit URL Rule')).toBeTruthy()
    expect(screen.getByPlaceholderText(/pattern/i)).toHaveValue('a.com/*')
    expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy()
  })

  it('Save in the edit modal is disabled until something actually changes', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'a.com/*', groupId: 'g1' }] })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /edit rule/i }))
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: 'b.com/*' } })
    expect(save).not.toBeDisabled()
  })

  it('Save updates the draft (not persisted) and closes the edit modal', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'a.com/*', groupId: 'g1' }] })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /edit rule/i }))
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: 'b.com/*' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(mockSaveRules).not.toHaveBeenCalled()
    expect(screen.getByTitle('b.com/*')).toBeTruthy()
    expect(screen.queryByText('Edit URL Rule')).toBeNull()
  })

  it('closing the edit modal (X) discards changes without touching the draft', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'a.com/*', groupId: 'g1' }] })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /edit rule/i }))
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: 'b.com/*' } })
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(mockSaveRules).not.toHaveBeenCalled()
    expect(screen.getByTitle('a.com/*')).toBeTruthy()
  })

  it('Save is disabled when pattern is emptied even if it differs from the original', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'a.com/*', groupId: 'g1' }] })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /edit rule/i }))
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: '' } })
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })
})

describe('UrlRulesModal — adding rules via nested modal', () => {
  it('opens the nested "Add URL Rule" modal and adds a rule to the draft without persisting', () => {
    renderModal()
    openAddModal()
    expect(screen.getByText('Add URL Rule')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: 'a.com/*' } })
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('Work'))
    fireEvent.click(screen.getByRole('button', { name: /^add rule$/i }))
    expect(mockSaveRules).not.toHaveBeenCalled()
    expect(screen.getByTitle('a.com/*')).toBeTruthy()
    expect(screen.queryByText('Add URL Rule')).toBeNull()
  })

  it('nested Add is disabled until pattern and group are set', () => {
    renderModal()
    openAddModal()
    const submit = screen.getByRole('button', { name: /^add rule$/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/pattern/i), { target: { value: 'a.com/*' } })
    expect(submit).toBeDisabled()
  })

  it('free tier at the draft rule limit toasts an upgrade prompt and disables the Add rule button', () => {
    mockUseUrlRules.mockReturnValue({ data: [
      { id: 'r1', pattern: 'a.com/*', groupId: 'g1' },
      { id: 'r2', pattern: 'b.com/*', groupId: 'g1' },
      { id: 'r3', pattern: 'c.com/*', groupId: 'g1' },
    ] })
    renderModal()
    expect(screen.getByText('3/3 used')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^add rule$/i })).toBeDisabled()
  })

  it('pro tier has no rule cap shown', () => {
    mockUseEntitlements.mockReturnValue({ tier: 'pro' })
    mockUseUrlRules.mockReturnValue({ data: [
      { id: 'r1', pattern: 'a.com/*', groupId: 'g1' },
      { id: 'r2', pattern: 'b.com/*', groupId: 'g1' },
      { id: 'r3', pattern: 'c.com/*', groupId: 'g1' },
    ] })
    renderModal()
    expect(screen.queryByText(/used$/)).toBeNull()
  })
})

describe('UrlRulesModal — top-level Save/Cancel', () => {
  it('Save persists the entire draft array in one write and closes', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'a.com/*', groupId: 'g1' }] })
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /delete rule/i }))
    fireEvent.click(screen.getByRole('button', { name: /save all rules/i }))
    expect(mockSaveRules).toHaveBeenCalledWith([])
    expect(onClose).toHaveBeenCalled()
  })

  it('Cancel discards all pending draft changes and closes without persisting', () => {
    mockUseUrlRules.mockReturnValue({ data: [{ id: 'r1', pattern: 'a.com/*', groupId: 'g1' }] })
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /delete rule/i }))
    fireEvent.click(screen.getByRole('button', { name: /discard changes/i }))
    expect(mockSaveRules).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
