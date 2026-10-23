import { describe, it, expect, beforeEach } from 'vitest'
import { AI_BYOK_KEY_STORAGE_KEY, InvalidByokKeyError, clearByokKey, getByokKey, normalizeByokKey, saveByokKey } from '@/lib/byokKey'
import { DEFAULT_APP_SETTINGS } from '@/hooks/useAppSettings'

/** Shaped like an Anthropic key, but too short to look like a real one to the secret scanner. */
const KEY = 'sk-ant-test-xxxxxxxxxxxxxxxx'

beforeEach(async () => {
  await clearByokKey()
})

describe('byokKey storage', () => {
  it('saves and reads back the key for the account that saved it', async () => {
    await saveByokKey('u1', KEY)
    expect(await getByokKey('u1')).toBe(KEY)
  })

  it('trims pasted whitespace before checking and saving', async () => {
    await saveByokKey('u1', `  ${KEY}\n`)
    expect(await getByokKey('u1')).toBe(KEY)
    expect(normalizeByokKey(` ${KEY} `)).toBe(KEY)
  })

  it.each(['', 'sk-ant-short', 'sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx', 'sk-ant-has spaces in it xxxxxxxx', 'sk-ant-<script>xxxxxxxxxxxxxxx'])(
    'rejects %j and stores nothing',
    async (text) => {
      await expect(saveByokKey('u1', text)).rejects.toBeInstanceOf(InvalidByokKeyError)
      expect((await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY]).toBeUndefined()
    }
  )

  it('does not hand one account the key another account saved', async () => {
    await saveByokKey('u1', KEY)
    expect(await getByokKey('u2')).toBeNull()
    expect(await getByokKey(undefined)).toBeNull()
  })

  it('treats a malformed stored value as no key', async () => {
    await chrome.storage.local.set({ [AI_BYOK_KEY_STORAGE_KEY]: { userId: 'u1', key: 'not-a-key' } })
    expect(await getByokKey('u1')).toBeNull()
    await chrome.storage.local.set({ [AI_BYOK_KEY_STORAGE_KEY]: KEY })
    expect(await getByokKey('u1')).toBeNull()
  })

  it('clearByokKey removes it', async () => {
    await saveByokKey('u1', KEY)
    await clearByokKey()
    expect(await getByokKey('u1')).toBeNull()
  })

  it('is not an app setting, so exports and backups of appSettings never carry it', () => {
    expect(Object.keys(DEFAULT_APP_SETTINGS)).not.toContain(AI_BYOK_KEY_STORAGE_KEY)
    expect(JSON.stringify(DEFAULT_APP_SETTINGS)).not.toMatch(/sk-ant-|byok/i)
  })
})
