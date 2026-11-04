import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AI_BYOK_KEY_STORAGE_KEY,
  AI_BYOK_PROVIDER_STORAGE_KEY,
  InvalidByokKeyError,
  clearByokKey,
  getByokKey,
  getPickedByokProvider,
  normalizeByokKey,
  saveByokKey,
  setPickedByokProvider
} from '@/lib/byokKey'
import { DEFAULT_APP_SETTINGS } from '@/hooks/useAppSettings'

/** Shaped like each provider's keys, but too short (Anthropic) or built at run time to stay clear of secret scanners. */
const ANTHROPIC_KEY = 'sk-ant-test-xxxxxxxxxxxxxxxx'
const OPENAI_KEY = 'sk-proj-' + 'y'.repeat(24)
const GOOGLE_KEY = 'AIza' + 'z'.repeat(35)

beforeEach(async () => {
  await clearByokKey()
})

describe('byokKey storage', () => {
  it.each([
    [ANTHROPIC_KEY, 'anthropic'],
    [OPENAI_KEY, 'openai'],
    [GOOGLE_KEY, 'google']
  ])('saves %s with the provider read from its shape, and reads both back', async (key, provider) => {
    expect(await saveByokKey('u1', key)).toEqual({ key, provider })
    expect(await getByokKey('u1')).toEqual({ key, provider })
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toEqual({ userId: 'u1', key, provider })
  })

  it('keeps one key at a time: saving another provider replaces it', async () => {
    await saveByokKey('u1', ANTHROPIC_KEY)
    await saveByokKey('u1', GOOGLE_KEY)
    expect(await getByokKey('u1')).toEqual({ key: GOOGLE_KEY, provider: 'google' })
  })

  it('trims pasted whitespace before checking and saving', async () => {
    await saveByokKey('u1', `  ${ANTHROPIC_KEY}\n`)
    expect((await getByokKey('u1'))?.key).toBe(ANTHROPIC_KEY)
    expect(normalizeByokKey(` ${ANTHROPIC_KEY} `)).toBe(ANTHROPIC_KEY)
  })

  it.each([
    '',
    'sk-ant-short',
    'sk-admin-' + 'a'.repeat(24),
    'AIza' + 'z'.repeat(10),
    'sk-ant-has spaces in it xxxxxxxx',
    'sk-ant-<script>xxxxxxxxxxxxxxx'
  ])('rejects %j and stores nothing', async (text) => {
    await expect(saveByokKey('u1', text)).rejects.toBeInstanceOf(InvalidByokKeyError)
    expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toBeUndefined()
  })

  it('does not hand one account the key another account saved', async () => {
    await saveByokKey('u1', ANTHROPIC_KEY)
    expect(await getByokKey('u2')).toBeNull()
    expect(await getByokKey(undefined)).toBeNull()
  })

  it('treats a malformed stored value as no key, including a provider that does not match the key', async () => {
    await chrome.storage.local.set({ [AI_BYOK_KEY_STORAGE_KEY]: { userId: 'u1', key: 'not-a-key', provider: 'anthropic' } })
    expect(await getByokKey('u1')).toBeNull()
    await chrome.storage.local.set({ [AI_BYOK_KEY_STORAGE_KEY]: { userId: 'u1', key: OPENAI_KEY, provider: 'google' } })
    expect(await getByokKey('u1')).toBeNull()
    await chrome.storage.local.set({ [AI_BYOK_KEY_STORAGE_KEY]: ANTHROPIC_KEY })
    expect(await getByokKey('u1')).toBeNull()
  })

  it('clearByokKey removes it', async () => {
    await saveByokKey('u1', ANTHROPIC_KEY)
    await clearByokKey()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('is not an app setting, so exports and backups of appSettings never carry it', () => {
    expect(Object.keys(DEFAULT_APP_SETTINGS)).not.toContain(AI_BYOK_KEY_STORAGE_KEY)
    expect(JSON.stringify(DEFAULT_APP_SETTINGS)).not.toMatch(/sk-|AIza|byok/i)
  })
})

describe('picked provider without a key', () => {
  it('remembers the pick for the account that made it, and forgets it on null', async () => {
    await setPickedByokProvider('u1', 'google')
    expect((await chrome.storage.local.get(AI_BYOK_PROVIDER_STORAGE_KEY))[AI_BYOK_PROVIDER_STORAGE_KEY]).toEqual({ userId: 'u1', provider: 'google' })
    expect(await getPickedByokProvider('u1')).toBe('google')
    expect(await getPickedByokProvider('u2')).toBeNull()
    expect(await getPickedByokProvider(undefined)).toBeNull()
    await setPickedByokProvider('u1', null)
    expect(await getPickedByokProvider('u1')).toBeNull()
  })

  it('reads a malformed or unknown stored pick as no pick', async () => {
    for (const value of ['google', { userId: 'u1', provider: 'mistral' }, { provider: 'openai' }, null]) {
      await chrome.storage.local.set({ [AI_BYOK_PROVIDER_STORAGE_KEY]: value })
      expect(await getPickedByokProvider('u1')).toBeNull()
    }
  })

  it('clearByokKey (Remove, sign-out) forgets the pick too', async () => {
    await saveByokKey('u1', ANTHROPIC_KEY)
    await setPickedByokProvider('u1', 'openai')
    await clearByokKey()
    expect(await getPickedByokProvider('u1')).toBeNull()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('never throws when storage fails', async () => {
    const local = chrome.storage.local as unknown as Record<string, ReturnType<typeof vi.fn>>
    const get = vi.spyOn(local, 'get').mockRejectedValueOnce(new Error('no storage'))
    expect(await getPickedByokProvider('u1')).toBeNull()
    const set = vi.spyOn(local, 'set').mockRejectedValueOnce(new Error('no storage'))
    await expect(setPickedByokProvider('u1', 'google')).resolves.toBeUndefined()
    const remove = vi.spyOn(local, 'remove').mockRejectedValueOnce(new Error('no storage'))
    await expect(clearByokKey()).resolves.toBeUndefined()
    get.mockRestore()
    set.mockRestore()
    remove.mockRestore()
  })
})
