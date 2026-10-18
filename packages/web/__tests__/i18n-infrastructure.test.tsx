/**
 * The i18n plumbing around the catalogs: locale lists and URL helpers, the pseudo-locale, the
 * catalog loader, the client subset of the catalog, the language switcher, the `[locale]`
 * segment's validation, and the copy that must keep reading exactly as `@tabmerger/shared` says.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PRICING_TIERS, SUPPORTED_LOCALES, formatListPrice } from '@tabmerger/shared'
import en from '@/messages/en'
import {
  DEFAULT_LOCALE,
  LOCALES,
  PSEUDO_LOCALE,
  PUBLIC_LOCALES,
  isAppLocale,
  languageAlternates,
  localeDirection,
  localizedPath,
} from '@/i18n/locales'
import { pseudoLocalize, pseudoLocalizeMessage } from '@/i18n/pseudo'
import { CLIENT_NAMESPACES, clientMessages, loadMessages } from '@/i18n/messages'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { useGithubRepoLabel, useStarCount } from '@/components/layout/githubLabels'
import { TIER_FEATURE_LINES, useTierFeatures, useTierName } from '@/components/pricing/tierFeatures'
import { useListPrice, useZeroPrice } from '@/components/pricing/priceFormat'
import { useYearlySubtext } from '@/components/pricing/useYearlySubtext'
import { YEARLY_SAVINGS, yearlySavings } from '@/lib/tiers'

const WEB = resolve(__dirname, '..')

describe('locales', () => {
  it('ships exactly the shared SUPPORTED_LOCALES, with English as the default', () => {
    expect(PUBLIC_LOCALES).toEqual(SUPPORTED_LOCALES)
    expect(PUBLIC_LOCALES).toContain('en')
    expect(DEFAULT_LOCALE).toBe('en')
  })

  it('routes the pseudo-locale outside production builds (tests and next dev)', () => {
    expect(LOCALES).toEqual([...SUPPORTED_LOCALES, PSEUDO_LOCALE])
  })

  it('never routes the pseudo-locale in a production build', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const prod = await import('@/i18n/locales')
    expect(prod.LOCALES).toEqual(SUPPORTED_LOCALES)
    expect(prod.isAppLocale(PSEUDO_LOCALE)).toBe(false)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('accepts only routable locales', () => {
    for (const locale of SUPPORTED_LOCALES) expect(isAppLocale(locale)).toBe(true)
    for (const value of ['EN', 'xx', 'en-US', 'pt-br', '', '../en', 'auth', undefined, 1]) expect(isAppLocale(value)).toBe(false)
  })

  it('keeps English URLs unprefixed and prefixes the others', () => {
    expect(localizedPath('en', '/')).toBe('/')
    expect(localizedPath('en', '/pricing')).toBe('/pricing')
    expect(localizedPath('es', '/')).toBe('/es')
    expect(localizedPath('es', '/pricing')).toBe('/es/pricing')
  })

  it('lists one hreflang alternate per public locale plus x-default, never the pseudo-locale', () => {
    const alternates = languageAlternates('/pricing')
    expect(Object.keys(alternates).sort()).toEqual([...SUPPORTED_LOCALES, 'x-default'].sort())
    for (const locale of SUPPORTED_LOCALES) expect(alternates[locale]).toBe(localizedPath(locale, '/pricing'))
    expect(alternates.fr).toBe('/fr/pricing')
    expect(alternates['x-default']).toBe('/pricing')
    expect(alternates).not.toHaveProperty(PSEUDO_LOCALE)
  })

  it('is left-to-right for every shipped locale', () => {
    for (const locale of LOCALES) expect(localeDirection(locale)).toBe('ltr')
  })
})

describe('pseudo-localization', () => {
  it('accents, lengthens and brackets the text', () => {
    const out = pseudoLocalizeMessage('Pricing plans')
    expect(out.startsWith('[') && out.endsWith(']')).toBe(true)
    expect(out).not.toMatch(/[A-Za-z]/)
    expect(out.length).toBeGreaterThan('Pricing plans'.length * 1.3)
  })

  it('leaves placeholders, plural arguments and rich-text tags intact', () => {
    expect(pseudoLocalizeMessage('Hi {name}')).toBe('[Ĥîî {name}]')
    expect(pseudoLocalizeMessage('See <link>FAQ</link>.')).toBe('[Šéééé <link>ƑÁÁǪ</link>.]')
    const plural = pseudoLocalizeMessage('{count, plural, one {# tab} other {# tabs}}')
    expect(plural).toBe('[{count, plural, one {# ţááƀ} other {# ţááƀš}}]')
    expect(pseudoLocalizeMessage("'{'literal'}'")).toContain("'{'")
  })

  it('keeps the catalog shape', () => {
    const pseudo = pseudoLocalize(en)
    expect(Object.keys(pseudo)).toEqual(Object.keys(en))
    expect(pseudo.nav.pricing).toBe(pseudoLocalizeMessage(en.nav.pricing))
  })
})

describe('catalog loading', () => {
  it('serves the English catalog for English and the pseudo-locale for en-XA', async () => {
    expect(await loadMessages('en')).toBe(en)
    expect((await loadMessages(PSEUDO_LOCALE)).nav.pricing).toBe(pseudoLocalizeMessage(en.nav.pricing))
  })

  it('serves French for fr (with English filling any key not translated yet)', async () => {
    const fr = await loadMessages('fr')
    expect(fr.nav.pricing).toBe('Tarifs')
    expect(fr.nav.pricing).not.toBe(en.nav.pricing)
    expect(Object.keys(fr)).toEqual(expect.arrayContaining(Object.keys(en)))
  })

  it('has a loader with its own catalog for every shipped locale', async () => {
    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
      expect((await loadMessages(locale)).nav.pricing, locale).not.toBe(en.nav.pricing)
    }
  })

  it('sends the browser only the namespaces Client Components read', () => {
    const subset = clientMessages(en) as Record<string, Record<string, unknown>>
    expect(Object.keys(subset)).not.toContain('metadata')
    expect(Object.keys(subset)).not.toContain('featuresPage')
    // A sub-namespace brings only itself: the beta guide's long copy stays on the server.
    expect(Object.keys(subset.beta)).toEqual(['interactive'])
    expect(subset.dashboard).toBe(en.dashboard)
  })
})

/** Every file a 'use client' module imports (with `@/` or relative paths), transitively. */
function clientModuleGraph(): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (name === 'node_modules' || name.startsWith('.') || name === '__tests__' || name === 'e2e') continue
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(tsx?|jsx?)$/.test(name)) files.push(path)
    }
  }
  for (const dir of ['app', 'components', 'lib']) walk(join(WEB, dir))

  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? join(WEB, spec.slice(2)) : resolve(dirname(from), spec)
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        // not this one
      }
    }
    return null
  }

  const seen = new Set<string>()
  const queue = files.filter((f) => /^['"]use client['"]/.test(readFileSync(f, 'utf8').trimStart()))
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const [, spec] of source.matchAll(/(?:from|import)\s*\(?\s*['"]((?:@\/|\.{1,2}\/)[^'"]+)['"]/g)) {
      const target = resolveImport(file, spec)
      if (target && !seen.has(target)) queue.push(target)
    }
  }
  return [...seen]
}

describe('client namespaces', () => {
  it('covers every namespace a Client Component (or anything it imports) reads', () => {
    const covered = (ns: string) => CLIENT_NAMESPACES.some((entry) => ns === entry || ns.startsWith(`${entry}.`))
    const missing: string[] = []
    for (const file of clientModuleGraph()) {
      for (const [, ns] of readFileSync(file, 'utf8').matchAll(/useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (!covered(ns)) missing.push(`${file.slice(WEB.length + 1)}: ${ns}`)
      }
    }
    expect(missing).toEqual([])
  })
})

// Placement and switching behavior: LanguageSwitcher.test.tsx.
describe('LanguageSwitcher', () => {
  it('offers one menu item per public locale, each in its own language, the current one checked', async () => {
    render(<LanguageSwitcher />)
    await userEvent.click(await screen.findByRole('button', { name: 'Language: English (EN)' }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.getAttribute('lang'))).toEqual([...SUPPORTED_LOCALES])
    // Each item names its language (not an empty or English label).
    for (const item of items) expect(item.textContent?.trim()).not.toBe('')
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true').map((i) => i.getAttribute('lang'))).toEqual([DEFAULT_LOCALE])
    expect(items.some((item) => item.getAttribute('lang') === PSEUDO_LOCALE)).toBe(false)
  })
})

describe('[locale] segment', () => {
  it('answers 404 for anything that is not a routable locale', async () => {
    const { default: LocaleLayout } = await import('@/app/[locale]/layout')
    await expect(LocaleLayout({ children: null, params: Promise.resolve({ locale: 'xx' }) })).rejects.toThrow(/404/)
    await expect(LocaleLayout({ children: 'ok', params: Promise.resolve({ locale: 'en' }) })).resolves.toBe('ok')
  })

  it('pre-renders one page per routable locale', async () => {
    const { generateStaticParams } = await import('@/app/[locale]/layout')
    expect(generateStaticParams()).toEqual(LOCALES.map((locale) => ({ locale })))
  })
})

// The shared constants stay the single source of what is sold and how prices read; the
// translated copy must say exactly the same thing in English.
describe('English copy matches @tabmerger/shared', () => {
  it('renders every plan feature line exactly as PRICING_TIERS lists it', () => {
    const { result } = renderHook(() => useTierFeatures())
    const sharedId = { free: 'free', pro: 'pro', proAi: 'pro_ai' } as const
    for (const tier of Object.keys(TIER_FEATURE_LINES) as (keyof typeof TIER_FEATURE_LINES)[]) {
      const shared = PRICING_TIERS.find((t) => t.id === sharedId[tier])!
      expect(result.current(tier).map((f) => f.text)).toEqual(shared.features)
      // "Everything in …" lines are the inherited ones.
      expect(result.current(tier).map((f) => f.inherited)).toEqual(shared.features.map((f) => f.startsWith('Everything in ')))
    }
  })

  it('names the plans as PRICING_TIERS does', () => {
    const { result } = renderHook(() => useTierName())
    expect([result.current('free'), result.current('pro'), result.current('proAi')]).toEqual(PRICING_TIERS.map((t) => t.name))
  })

  it('formats list prices like formatListPrice', () => {
    const { result } = renderHook(() => ({ list: useListPrice(), zero: useZeroPrice() }))
    for (const amount of [3.99, 42.99, 7.99, 85.99, 3.5825, 7, 0.5]) expect(result.current.list(amount)).toBe(formatListPrice(amount))
    expect(result.current.zero).toBe('$0')
  })

  it('writes the yearly line under a paid plan', () => {
    const { result } = renderHook(() => useYearlySubtext())
    expect(result.current(YEARLY_SAVINGS.pro)).toBe('$3.58/mo billed yearly · save 10%')
    expect(result.current(YEARLY_SAVINGS.proAi)).toBe('$7.17/mo billed yearly · save 10%')
    expect(result.current(yearlySavings(5, 60))).toBe('$5.00/mo billed yearly')
  })
})

describe('GitHub badge labels', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [187, '187'],
    [1234, '1.2K'],
    [12_500, '12.5K'],
  ])('formats %i stars as %s', (count, text) => {
    const { result } = renderHook(() => useStarCount())
    expect(result.current(count)).toBe(text)
  })

  it('states the exact count, with the singular for one star and a separator', () => {
    const label = (count?: number | null) => renderHook(() => useGithubRepoLabel(count)).result.current
    expect(label(187)).toBe('TabMerger on GitHub, 187 stars')
    expect(label(0)).toBe('TabMerger on GitHub, 0 stars')
    expect(label(1)).toBe('TabMerger on GitHub, 1 star')
    expect(label(1234)).toBe('TabMerger on GitHub, 1,234 stars')
  })

  it('names only the destination when there is no count', () => {
    expect(renderHook(() => useGithubRepoLabel(null)).result.current).toBe('TabMerger on GitHub')
    expect(renderHook(() => useGithubRepoLabel(undefined)).result.current).toBe('TabMerger on GitHub')
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})
