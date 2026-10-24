import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { AiProvider } from '@tabmerger/shared'
import { AiKeySetting } from '@/components/Settings/AiKeySetting'
import type { SavedByokKeyInfo } from '@/hooks/useByokKey'
import { clearByokKey, getByokKey, saveByokKey } from '@/lib/byokKey'
import { t } from '@/lib/i18n'

const { mockAiPost, mockToast, mockAuth } = vi.hoisted(() => ({
  mockAiPost: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
  mockAuth: vi.fn()
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth() }))
vi.mock('@/hooks/useAI', () => ({ aiPost: mockAiPost }))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))

/** Key-shaped test values: too short (Anthropic) or built at run time, so no secret scanner flags them. */
const KEY = 'sk-ant-test-xxxxxxxxxxxxxxxx'
const OPENAI_KEY = 'sk-proj-' + 'y'.repeat(24)

interface Props {
  provider?: AiProvider
  saved?: SavedByokKeyInfo | null
  onSaved?: (p: AiProvider) => void
  onRemoved?: (p: AiProvider) => void
  onCancelSwitch?: () => void
}

function renderKey({ provider = 'anthropic', saved = null, ...rest }: Props = {}) {
  const refresh = vi.fn().mockResolvedValue(undefined)
  render(React.createElement(AiKeySetting, { provider, saved, refresh, ...rest }))
  return refresh
}

async function typeAndSave(key: string) {
  await userEvent.type(screen.getByTestId('ai-byok-key-input'), key)
  await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.save') }))
}

beforeEach(async () => {
  vi.clearAllMocks()
  await clearByokKey()
  mockAuth.mockReturnValue({ user: { id: 'u1' }, session: { access_token: 'tok' } })
})

describe('AiKeySetting', () => {
  it.each([
    ['anthropic', 'Anthropic', 'sk-ant-…'],
    ['openai', 'OpenAI', 'sk-proj-…'],
    ['google', 'Google', 'AIza…']
  ] as const)('%s: labels the field with the provider and shows only its key format', (provider, label, placeholder) => {
    renderKey({ provider })
    const input = screen.getByLabelText(t('settings.ai.key.label', { provider: label })) as HTMLInputElement
    expect(input.placeholder).toBe(placeholder)
    expect(input.getAttribute('dir')).toBe('ltr')
    expect(screen.getByText(t('settings.ai.key.note')).id).toBeTruthy()
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText(t('settings.ai.key.note')).id)
  })

  it('Save is disabled until something is typed', async () => {
    renderKey()
    const save = screen.getByRole('button', { name: t('settings.ai.key.save') })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByTestId('ai-byok-key-input'), 'x')
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it("refuses another provider's key before any request", async () => {
    renderKey({ provider: 'anthropic' })
    await typeAndSave(OPENAI_KEY)
    expect(screen.getByTestId('ai-byok-key-error').textContent).toBe(
      t('settings.ai.key.wrongProvider', { detected: 'OpenAI', provider: 'Anthropic' })
    )
    expect(mockAiPost).not.toHaveBeenCalled()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('a signed-out user gets the sign-in error and nothing is sent', async () => {
    mockAuth.mockReturnValue({ user: null, session: null })
    renderKey()
    await typeAndSave(KEY)
    expect(screen.getByRole('alert').textContent).toBe(t('errors.notAuthenticated'))
    expect(mockAiPost).not.toHaveBeenCalled()
  })

  it('a verify answer without ok is not a pass', async () => {
    mockAiPost.mockResolvedValue({ provider: 'anthropic' })
    renderKey()
    await typeAndSave(KEY)
    expect((await screen.findByRole('alert')).textContent).toBe(t('settings.ai.key.verifyFailed'))
    expect(await getByokKey('u1')).toBeNull()
  })

  it('saves a verified key, re-reads it and reports its provider', async () => {
    mockAiPost.mockResolvedValue({ ok: true })
    const onSaved = vi.fn()
    const refresh = renderKey({ onSaved })
    await typeAndSave(`  ${KEY} `)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('anthropic'))
    expect(refresh).toHaveBeenCalled()
    expect(await getByokKey('u1')).toEqual({ key: KEY, provider: 'anthropic' })
    expect(mockToast.success).toHaveBeenCalledWith(t('settings.ai.key.saved'))
    expect((screen.getByTestId('ai-byok-key-input') as HTMLInputElement).value).toBe('')
  })

  it('with a key of this provider saved: masked key with Replace and Remove, no field', () => {
    renderKey({ saved: { masked: 'sk-ant-…xxxx', provider: 'anthropic' } })
    expect(screen.getByTestId('ai-byok-key-masked').textContent).toBe('sk-ant-…xxxx')
    expect(screen.queryByTestId('ai-byok-key-input')).toBeNull()
    expect(screen.getByRole('button', { name: t('settings.ai.key.replace') })).toBeTruthy()
    expect(screen.getByRole('button', { name: t('settings.ai.key.remove') })).toBeTruthy()
  })

  it('Remove clears the key and hands the provider back so it stays picked', async () => {
    await saveByokKey('u1', KEY)
    const onRemoved = vi.fn()
    const refresh = renderKey({ saved: { masked: 'sk-ant-…xxxx', provider: 'anthropic' }, onRemoved })
    await userEvent.click(screen.getByRole('button', { name: t('settings.ai.key.remove') }))
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('anthropic'))
    expect(refresh).toHaveBeenCalled()
    expect(await getByokKey('u1')).toBeNull()
    expect(mockToast.success).toHaveBeenCalledWith(t('settings.ai.key.removed'))
  })

  it("with another provider's key saved: one line says it stays in use, and Cancel asks to switch back", async () => {
    const onCancelSwitch = vi.fn()
    renderKey({ provider: 'google', saved: { masked: 'sk-…yyyy', provider: 'openai' }, onCancelSwitch })
    const note = screen.getByTestId('ai-byok-switch-note')
    expect(note.textContent).toBe(t('settings.ai.key.switching', { saved: 'OpenAI', provider: 'Google' }))
    expect(screen.queryByTestId('ai-byok-key-masked')).toBeNull()
    expect(screen.queryByRole('button', { name: t('settings.ai.key.remove') })).toBeNull()
    const input = screen.getByTestId('ai-byok-key-input')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(note.id)
    await userEvent.type(input, 'abc')
    await userEvent.click(screen.getByRole('button', { name: t('common.cancel') }))
    expect(onCancelSwitch).toHaveBeenCalledTimes(1)
  })

  it('focus order: key field, Save, Cancel, then the setup links', async () => {
    renderKey({ provider: 'google', saved: { masked: 'sk-…yyyy', provider: 'openai' } })
    await userEvent.type(screen.getByTestId('ai-byok-key-input'), 'a')
    const order = [
      screen.getByTestId('ai-byok-key-input'),
      screen.getByRole('button', { name: t('common.showPassphrase') }),
      screen.getByRole('button', { name: t('settings.ai.key.save') }),
      screen.getByRole('button', { name: t('common.cancel') }),
      screen.getByRole('link', { name: t('settings.ai.key.guideLink') }),
      screen.getByRole('link', { name: t('settings.ai.key.keysLink', { provider: 'Google' }) })
    ]
    order[0].focus()
    for (const next of order.slice(1)) {
      await userEvent.tab()
      expect(document.activeElement).toBe(next)
    }
  })
})
