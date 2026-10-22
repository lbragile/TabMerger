import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from '@tabmerger/shared'
import {
  LOCALE_PREFERENCE_AUTO,
  LOCALE_PREFERENCE_LOCAL_STORAGE_KEY,
  LOCALE_PREFERENCE_STORAGE_KEY,
  localePreferenceChoices,
  canonicalLanguageTag,
  localePreferenceLabel,
  normalizeLocalePreference,
  onLocalePreferenceChanged,
  preferredLanguageTag,
  readLocalePreference,
  readLocalePreferenceSync,
  reconcileLocalePreference,
  saveLocalePreference,
} from '@/lib/localePreference'

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void

/** A chrome.storage stand-in with a real store and an onChanged that fires on writes. */
function fakeChrome(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial))
  const listeners = new Set<Listener>()
  const fire = (key: string, newValue: unknown) => listeners.forEach((l) => l({ [key]: { newValue } }, 'local'))
  return {
    store,
    listeners,
    chrome: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) {
              store.set(k, v)
              fire(k, v)
            }
          }),
          remove: vi.fn(async (key: string) => {
            store.delete(key)
            fire(key, undefined)
          }),
        },
        onChanged: {
          addListener: vi.fn((l: Listener) => listeners.add(l)),
          removeListener: vi.fn((l: Listener) => listeners.delete(l)),
        },
      },
    },
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('canonicalLanguageTag', () => {
  it('replaces the retired language subtag and keeps the rest', () => {
    expect(canonicalLanguageTag('iw')).toBe('he')
    expect(canonicalLanguageTag('IW-il')).toBe('he-il')
    expect(canonicalLanguageTag('iw_IL')).toBe('he-IL')
    expect(canonicalLanguageTag('in')).toBe('id')
  })

  it('leaves current codes alone, reading _ as -', () => {
    expect(canonicalLanguageTag('he')).toBe('he')
    expect(canonicalLanguageTag('pt_BR')).toBe('pt-BR')
    expect(canonicalLanguageTag('de-IW')).toBe('de-IW')
    expect(canonicalLanguageTag('')).toBe('')
  })
})

describe('normalizeLocalePreference', () => {
  it('keeps a shipped locale', () => {
    for (const locale of SUPPORTED_LOCALES) expect(normalizeLocalePreference(locale)).toBe(locale)
  })

  it('reads a stored retired code as its current one (iw is Hebrew, in is Indonesian)', () => {
    expect(normalizeLocalePreference('in')).toBe('id')
    expect(normalizeLocalePreference('iw')).toBe('he')
  })

  it('falls back to auto for anything else (untrusted storage)', () => {
    for (const value of [undefined, null, '', 'auto', 'xx', 'pt-PT', 'EN', 42, {}, ['de']]) {
      expect(normalizeLocalePreference(value)).toBe(LOCALE_PREFERENCE_AUTO)
    }
  })
})

describe('preferredLanguageTag', () => {
  it('is the browser language for auto and the choice otherwise', () => {
    expect(preferredLanguageTag('auto', 'pt-PT')).toBe('pt-PT')
    expect(preferredLanguageTag('auto', undefined)).toBeUndefined()
    expect(preferredLanguageTag('ja', 'en-US')).toBe('ja')
  })
})

describe('readLocalePreferenceSync', () => {
  it('reads a valid stored choice', () => {
    localStorage.setItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY, 'de')
    expect(readLocalePreferenceSync()).toBe('de')
  })

  it('is auto when nothing, or something invalid, is stored', () => {
    expect(readLocalePreferenceSync()).toBe('auto')
    localStorage.setItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY, '<script>')
    expect(readLocalePreferenceSync()).toBe('auto')
  })

  it('is auto when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readLocalePreferenceSync()).toBe('auto')
  })

  it('is auto without localStorage (the background worker)', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readLocalePreferenceSync()).toBe('auto')
  })
})

describe('readLocalePreference', () => {
  it('reads and validates chrome.storage.local', async () => {
    vi.stubGlobal('chrome', fakeChrome({ [LOCALE_PREFERENCE_STORAGE_KEY]: 'fr' }).chrome)
    expect(await readLocalePreference()).toBe('fr')
    vi.stubGlobal('chrome', fakeChrome({ [LOCALE_PREFERENCE_STORAGE_KEY]: 'klingon' }).chrome)
    expect(await readLocalePreference()).toBe('auto')
  })

  it('is auto when storage is missing or rejects', async () => {
    vi.stubGlobal('chrome', undefined)
    expect(await readLocalePreference()).toBe('auto')
    const broken = fakeChrome()
    broken.chrome.storage.local.get.mockRejectedValue(new Error('gone'))
    vi.stubGlobal('chrome', broken.chrome)
    expect(await readLocalePreference()).toBe('auto')
  })
})

describe('saveLocalePreference', () => {
  it('writes both stores', async () => {
    const fake = fakeChrome()
    vi.stubGlobal('chrome', fake.chrome)
    await saveLocalePreference('zh-CN')
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBe('zh-CN')
    expect(fake.store.get(LOCALE_PREFERENCE_STORAGE_KEY)).toBe('zh-CN')
  })

  it('auto removes both, and an invalid value is saved as auto', async () => {
    const fake = fakeChrome()
    vi.stubGlobal('chrome', fake.chrome)
    await saveLocalePreference('de')
    await saveLocalePreference('nope' as never)
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBeNull()
    expect(fake.store.has(LOCALE_PREFERENCE_STORAGE_KEY)).toBe(false)
  })

  it('still mirrors to localStorage without chrome.storage', async () => {
    vi.stubGlobal('chrome', undefined)
    await saveLocalePreference('es')
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBe('es')
  })
})

describe('reconcileLocalePreference', () => {
  it('copies the stored choice into a cleared localStorage and returns it', async () => {
    vi.stubGlobal('chrome', fakeChrome({ [LOCALE_PREFERENCE_STORAGE_KEY]: 'ja' }).chrome)
    expect(await reconcileLocalePreference()).toBe('ja')
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBe('ja')
  })

  it('returns null when both agree, or without chrome.storage', async () => {
    localStorage.setItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY, 'ja')
    vi.stubGlobal('chrome', fakeChrome({ [LOCALE_PREFERENCE_STORAGE_KEY]: 'ja' }).chrome)
    expect(await reconcileLocalePreference()).toBeNull()
    vi.stubGlobal('chrome', undefined)
    expect(await reconcileLocalePreference()).toBeNull()
  })

  it('clears a stale localStorage copy when the stored choice is auto', async () => {
    localStorage.setItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY, 'de')
    vi.stubGlobal('chrome', fakeChrome().chrome)
    expect(await reconcileLocalePreference()).toBe('auto')
    expect(localStorage.getItem(LOCALE_PREFERENCE_LOCAL_STORAGE_KEY)).toBeNull()
  })
})

describe('onLocalePreferenceChanged', () => {
  it('reports validated changes of its key in the local area only', async () => {
    const fake = fakeChrome()
    vi.stubGlobal('chrome', fake.chrome)
    const seen: string[] = []
    const stop = onLocalePreferenceChanged((p) => seen.push(p))
    await saveLocalePreference('de')
    fake.listeners.forEach((l) => l({ [LOCALE_PREFERENCE_STORAGE_KEY]: { newValue: 'fr' } }, 'sync'))
    fake.listeners.forEach((l) => l({ other: { newValue: 'fr' } }, 'local'))
    fake.listeners.forEach((l) => l({ [LOCALE_PREFERENCE_STORAGE_KEY]: { newValue: 'evil' } }, 'local'))
    await saveLocalePreference('auto')
    expect(seen).toEqual(['de', 'auto', 'auto'])
    stop()
    expect(fake.listeners.size).toBe(0)
  })

  it('is a no-op without chrome.storage', () => {
    vi.stubGlobal('chrome', undefined)
    expect(() => onLocalePreferenceChanged(() => {})()).not.toThrow()
  })
})

describe('choices', () => {
  it('lists Browser default first, then every shipped locale', () => {
    expect(localePreferenceChoices()).toEqual(['auto', ...SUPPORTED_LOCALES])
  })

  it('labels auto with the given text and a locale by its native name', () => {
    expect(localePreferenceLabel('auto', 'Browser default')).toBe('Browser default')
    expect(localePreferenceLabel('de', 'x')).toBe('Deutsch')
    expect(localePreferenceLabel('ja', 'x')).toBe(LOCALE_NATIVE_NAMES.ja)
  })
})
