import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { getPricingTier } from '@tabmerger/shared'
import { t, formatNumber } from '@/lib/i18n'

/**
 * The Pro AI row of the upgrade prompt per live option: the own-key option can launch before
 * AI on TabMerger's key (`VITE_AI_BYOK_ENABLED`), and the managed flag turns both on. Each flag
 * combination is its own module graph (`vi.doMock` + `vi.resetModules`).
 */

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('@/stores/uiStore', () => ({ useUIStore: (sel: (s: { openModal: () => void }) => unknown) => sel({ openModal: vi.fn() }) }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const byokLine = () => t('upgrade.byokOption', { price: formatNumber(getPricingTier('pro_ai').byok!.monthlyPrice, { style: 'currency', currency: 'USD' }) })

async function renderWith(flags: { managed: boolean; byok: boolean }, reason = 'aiFeatures') {
  vi.resetModules()
  vi.doMock('@/lib/aiFlag', () => ({ AI_ENABLED: flags.byok, AI_MANAGED_ENABLED: flags.managed, AI_BYOK_ENABLED: flags.byok }))
  const { Dialog, DialogContent } = await import('@/components/ui/dialog')
  const { UpgradePromptModal } = await import('@/components/Modal/UpgradePrompt')
  render(<Dialog open><DialogContent><UpgradePromptModal reason={reason} onClose={vi.fn()} /></DialogContent></Dialog>)
}

beforeEach(() => {
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

describe('UpgradePromptModal — Pro AI options', () => {
  it('both off: Pro AI is coming soon, no own-key line, the AI upgrade button is disabled', async () => {
    await renderWith({ managed: false, byok: false })
    expect(screen.queryByTestId('upgrade-byok-option')).toBeNull()
    expect(screen.getByText(t('upgrade.comingSoonParen', { label: t('upgrade.comingSoon') }))).toBeTruthy()
    expect((screen.getByRole('button', { name: t('upgrade.comingSoon') }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("own key only: offers the own-key price, TabMerger's-key Pro AI stays coming soon, and the button works", async () => {
    await renderWith({ managed: false, byok: true })
    expect(screen.getByTestId('upgrade-byok-option').textContent).toBe(byokLine())
    expect(screen.getByText(t('upgrade.comingSoonParen', { label: t('upgrade.comingSoon') }))).toBeTruthy()
    expect((screen.getByRole('button', { name: t('upgrade.upgradeNow') }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('managed on: both options, nothing coming soon', async () => {
    await renderWith({ managed: true, byok: true })
    expect(screen.getByTestId('upgrade-byok-option')).toBeTruthy()
    expect(screen.queryByText(t('upgrade.comingSoonParen', { label: t('upgrade.comingSoon') }))).toBeNull()
  })
})
