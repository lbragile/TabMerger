import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { UpgradePromptModal } from '@/components/Modal/UpgradePrompt'

const mockUseAuth = vi.fn()
const mockOpenModal = vi.fn()
const mockTrackEvent = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('@/stores/uiStore', () => ({ useUIStore: (sel: (s: { openModal: typeof mockOpenModal }) => unknown) => sel({ openModal: mockOpenModal }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue({ user: null })
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

describe('UpgradePromptModal — reason messages', () => {
  it('shows the maxGroups message', () => {
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={vi.fn()} />)
    expect(screen.getByText('Group Limit Reached')).toBeTruthy()
  })

  it('tracks upgrade_prompt_shown once on mount with the reason as source', () => {
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={vi.fn()} />)
    expect(mockTrackEvent).toHaveBeenCalledWith('upgrade_prompt_shown', { source: 'maxGroups' })
    expect(mockTrackEvent).toHaveBeenCalledTimes(1)
  })

  it('tracks upgrade_prompt_shown with source "upgrade_prompt" when no reason is given', () => {
    renderModal(<UpgradePromptModal onClose={vi.fn()} />)
    expect(mockTrackEvent).toHaveBeenCalledWith('upgrade_prompt_shown', { source: 'upgrade_prompt' })
  })

  it('shows the maxTabs message', () => {
    renderModal(<UpgradePromptModal reason="maxTabs" onClose={vi.fn()} />)
    expect(screen.getByText('Tab Limit Reached')).toBeTruthy()
  })

  it('shows the cloudSync message', () => {
    renderModal(<UpgradePromptModal reason="cloudSync" onClose={vi.fn()} />)
    expect(screen.getByText('Cloud Sync is Pro')).toBeTruthy()
  })

  it('shows the aiFeatures message', () => {
    renderModal(<UpgradePromptModal reason="aiFeatures" onClose={vi.fn()} />)
    expect(screen.getByText('AI Features are Pro AI')).toBeTruthy()
  })

  it('falls back to the generic message for an unknown/missing reason', () => {
    renderModal(<UpgradePromptModal onClose={vi.fn()} />)
    expect(screen.getByText('Upgrade TabMerger')).toBeTruthy()
  })
})

describe('UpgradePromptModal — actions', () => {
  it('opens the pricing page and closes on "Upgrade now"', () => {
    const onClose = vi.fn()
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade now/i }))
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ active: true, url: expect.stringContaining('/pricing') }))
    expect(onClose).toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith('upgrade_clicked', { source: 'maxGroups' })
  })

  it('"Maybe later" closes without opening a tab', () => {
    const onClose = vi.fn()
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /maybe later/i }))
    expect(chrome.tabs.create).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('UpgradePromptModal — Pro AI coming-soon CTA', () => {
  it('always renders the real Pro AI price, never swaps it out, when AI is disabled', () => {
    renderModal(<UpgradePromptModal reason="aiFeatures" onClose={vi.fn()} />)
    expect(screen.getByText(/\$7\.99\/mo/).textContent).toContain('Pro AI')
  })

  it('disables the CTA with aria-disabled and "Coming soon" label when AI is disabled and reason is aiFeatures', () => {
    renderModal(<UpgradePromptModal reason="aiFeatures" onClose={vi.fn()} />)
    const cta = screen.getByRole('button', { name: /coming soon/i })
    expect(cta).toBeDisabled()
    expect(cta.getAttribute('aria-disabled')).toBe('true')
  })

  it('does not disable the CTA for a non-aiFeatures reason even when AI is disabled', () => {
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /upgrade now/i })).not.toBeDisabled()
  })
})

describe('UpgradePromptModal — signed-out sign-in offer', () => {
  it('shows a "Sign in" option and restore hint when signed out', () => {
    mockUseAuth.mockReturnValue({ user: null })
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy()
    expect(screen.getByText(/already have a pro account\? sign in to restore it/i)).toBeTruthy()
  })

  it('opens the auth modal and closes on "Sign in"', () => {
    mockUseAuth.mockReturnValue({ user: null })
    const onClose = vi.fn()
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(mockOpenModal).toHaveBeenCalledWith('auth')
    expect(onClose).toHaveBeenCalled()
  })

  it('hides the "Sign in" option and restore hint when already signed in', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1' } })
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^sign in$/i })).toBeNull()
    expect(screen.queryByText(/already have a pro account/i)).toBeNull()
  })
})
