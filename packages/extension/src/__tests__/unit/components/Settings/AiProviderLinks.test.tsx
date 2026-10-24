import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { AI_PROVIDER_KEY_LINKS, AI_PROVIDERS } from '@tabmerger/shared'
import { AiProviderLinks } from '@/components/Settings/AiProviderLinks'
import { t } from '@/lib/i18n'

const tabsCreate = vi.fn()
Object.assign(globalThis.chrome, { tabs: { create: tabsCreate } })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AiProviderLinks', () => {
  it('every provider has an https guide and keys page, and the links use them', () => {
    for (const provider of AI_PROVIDERS) {
      const { guide, keys } = AI_PROVIDER_KEY_LINKS[provider]
      expect(new URL(guide).protocol).toBe('https:')
      expect(new URL(keys).protocol).toBe('https:')
    }
    render(React.createElement(AiProviderLinks, { provider: 'anthropic' }))
    expect(screen.getByTestId('ai-provider-guide-link').getAttribute('href')).toBe(AI_PROVIDER_KEY_LINKS.anthropic.guide)
    expect(screen.getByTestId('ai-provider-keys-link').getAttribute('href')).toBe(AI_PROVIDER_KEY_LINKS.anthropic.keys)
    expect(screen.getByTestId('ai-provider-keys-link').textContent).toBe(t('settings.ai.key.keysLink', { provider: 'Anthropic' }))
  })

  it.each(AI_PROVIDERS)('%s: both links open in a new tab via the tabs API, without opener or referrer', async (provider) => {
    render(React.createElement(AiProviderLinks, { provider }))
    for (const [testId, url] of [
      ['ai-provider-guide-link', AI_PROVIDER_KEY_LINKS[provider].guide],
      ['ai-provider-keys-link', AI_PROVIDER_KEY_LINKS[provider].keys]
    ] as const) {
      const link = screen.getByTestId(testId)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      await userEvent.click(link)
      expect(tabsCreate).toHaveBeenLastCalledWith({ url, active: true })
    }
    expect(screen.getByTestId('ai-provider-links').textContent).toContain(t('settings.ai.key.getKey'))
  })
})
