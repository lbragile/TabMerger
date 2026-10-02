import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModalRoot } from '@/components/Modal'

const { mockUseUIStore } = vi.hoisted(() => ({ mockUseUIStore: vi.fn() }))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: unknown) => unknown) => mockUseUIStore(selector),
}))

// Stub all child modals so this only tests the switch/routing logic.
vi.mock('@/components/Modal/AddGroup', () => ({ AddGroupModal: () => <div data-testid="addGroup" /> }))
vi.mock('@/components/Modal/DeleteConfirm', () => ({ DeleteConfirmModal: ({ type }: { type: string }) => <div data-testid="deleteConfirm">{type}</div> }))
vi.mock('@/components/Modal/ImportExport', () => ({ ImportExportModal: ({ mode }: { mode: string }) => <div data-testid="importExport">{mode}</div> }))
vi.mock('@/components/Modal/Settings', () => ({ SettingsModal: () => <div data-testid="settings" /> }))
vi.mock('@/components/Modal/Auth', () => ({ AuthModal: () => <div data-testid="auth" /> }))
vi.mock('@/components/Modal/UpgradePrompt', () => ({ UpgradePromptModal: ({ reason }: { reason: string }) => <div data-testid="upgrade">{reason}</div> }))
vi.mock('@/components/Modal/DeduplicateConfirm', () => ({ DeduplicateConfirmModal: () => <div data-testid="dedupe" /> }))
vi.mock('@/components/Modal/UrlRules', () => ({ UrlRulesModal: () => <div data-testid="urlRules" /> }))
vi.mock('@/components/Modal/ReviewStaleTabs', () => ({ ReviewStaleTabsModal: () => <div data-testid="reviewStaleTabs" /> }))
vi.mock('@/components/Modal/SaveSession', () => ({ SaveSessionModal: () => <div data-testid="saveSession" /> }))

function mockState(modal: { type: string | null; data?: Record<string, unknown> }) {
  const closeModal = vi.fn()
  mockUseUIStore.mockImplementation((selector: (s: { modal: typeof modal; closeModal: typeof closeModal }) => unknown) =>
    selector({ modal, closeModal })
  )
  return { closeModal }
}

beforeEach(() => vi.clearAllMocks())

describe('ModalRoot — routing', () => {
  it('renders nothing when modal.type is null', () => {
    mockState({ type: null })
    const { container } = render(<ModalRoot />)
    expect(container.firstChild).toBeNull()
  })

  it.each([
    ['addGroup', 'addGroup'],
    ['settings', 'settings'],
    ['auth', 'auth'],
    ['deduplicateGroup', 'dedupe'],
    ['urlRules', 'urlRules'],
    ['reviewStaleTabs', 'reviewStaleTabs'],
    ['saveSession', 'saveSession'],
  ])('routes modal.type=%s to the correct component', (type, testId) => {
    mockState({ type })
    render(<ModalRoot />)
    expect(screen.getByTestId(testId)).toBeTruthy()
  })

  it.each(['deleteGroup', 'deleteWindow', 'deleteTab', 'deleteSelection', 'removeAllWindows', 'clearAllData'])(
    'routes all delete variants (%s) to DeleteConfirmModal',
    (type) => {
      mockState({ type })
      render(<ModalRoot />)
      expect(screen.getByTestId('deleteConfirm')).toHaveTextContent(type)
    }
  )

  it('passes data.mode to ImportExportModal, defaulting to "export"', () => {
    mockState({ type: 'importExport', data: {} })
    render(<ModalRoot />)
    expect(screen.getByTestId('importExport')).toHaveTextContent('export')
  })

  it('passes data.mode="import" through', () => {
    mockState({ type: 'importExport', data: { mode: 'import' } })
    render(<ModalRoot />)
    expect(screen.getByTestId('importExport')).toHaveTextContent('import')
  })

  it('passes data.reason to UpgradePromptModal', () => {
    mockState({ type: 'upgrade', data: { reason: 'maxTabs' } })
    render(<ModalRoot />)
    expect(screen.getByTestId('upgrade')).toHaveTextContent('maxTabs')
  })

  it('renders nothing for an unknown modal type', () => {
    // intentionally invalid type to hit the default branch
    mockState({ type: 'bogus' })
    render(<ModalRoot />)
    expect(screen.queryByTestId('addGroup')).toBeNull()
  })
})
