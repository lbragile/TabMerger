import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIQuotaExceededPrompt } from '@/components/AIQuotaExceededPrompt'

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome
})

describe('AIQuotaExceededPrompt', () => {
  it('renders the buy-more-credits CTA', () => {
    render(<AIQuotaExceededPrompt />)
    expect(screen.getByText(/used all your ai credits/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /get more/i })).toBeTruthy()
  })

  it('opens the web app account page in a new tab when clicked', () => {
    render(<AIQuotaExceededPrompt />)
    fireEvent.click(screen.getByRole('button', { name: /get more/i }))
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/account'), active: true })
    )
  })
})
