import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { UpgradePromptModal } from '@/components/Modal/UpgradePrompt'

function renderModal(ui: React.ReactElement) {
  return render(<Dialog open><DialogContent>{ui}</DialogContent></Dialog>)
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

describe('UpgradePromptModal — reason messages', () => {
  it('shows the maxGroups message', () => {
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={vi.fn()} />)
    expect(screen.getByText('Group Limit Reached')).toBeTruthy()
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
  })

  it('"Maybe later" closes without opening a tab', () => {
    const onClose = vi.fn()
    renderModal(<UpgradePromptModal reason="maxGroups" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /maybe later/i }))
    expect(chrome.tabs.create).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
