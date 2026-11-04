import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ACCOUNT_AI_CREDITS_ANCHOR } from '@tabmerger/shared'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIQuotaExceededPrompt } from '@/components/AIQuotaExceededPrompt'
import { useUIStore } from '@/stores/uiStore'
import { t } from '@/lib/i18n'
import { buyCreditsUrl } from '@/lib/buyCredits'

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
  useUIStore.getState().closeModal()
})

describe('AIQuotaExceededPrompt', () => {
  it('suggests a cheaper model or more credits', () => {
    render(<AIQuotaExceededPrompt />)
    expect(screen.getByText(t('banners.aiQuotaPrompt'))).toBeTruthy()
    expect(screen.getByRole('button', { name: /get more/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: t('banners.changeModel') })).toBeTruthy()
  })

  it("opens the web app account page's credits section in a new tab when clicked (the shared buy-credits helper)", () => {
    render(<AIQuotaExceededPrompt />)
    fireEvent.click(screen.getByRole('button', { name: /get more/i }))
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: buyCreditsUrl(), active: true })
    expect(buyCreditsUrl()).toBe(`${import.meta.env.VITE_WEB_APP_URL}/account#${ACCOUNT_AI_CREDITS_ANCHOR}`)
  })

  it('"Change model" opens Settings on the AI tab', () => {
    render(<AIQuotaExceededPrompt />)
    fireEvent.click(screen.getByRole('button', { name: t('banners.changeModel') }))
    expect(useUIStore.getState().modal).toEqual({ type: 'settings', data: { tab: 'ai' } })
  })
})
