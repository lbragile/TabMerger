import en from '@/messages/en'
import { DEFAULT_LOCALE, PSEUDO_LOCALE, PSEUDO_LOCALE_ENABLED, type AppLocale } from './locales'
import { pseudoLocalize, type MessageTree } from './pseudo'

export type Messages = typeof en

/**
 * Catalog loaders, one per shipped locale (`messages/<locale>/index.ts`, one JSON file per
 * namespace). English is the source catalog every other one is checked against
 * (`__tests__/i18n-catalogs.test.ts`). To add a language, add its folder and a line here (see
 * docs/I18N.md).
 */
const CATALOGS: Partial<Record<AppLocale, () => Promise<MessageTree>>> = {
  en: async () => en,
  de: async () => (await import('@/messages/de')).default,
  es: async () => (await import('@/messages/es')).default,
  fr: async () => (await import('@/messages/fr')).default,
  ja: async () => (await import('@/messages/ja')).default,
  it: async () => (await import('@/messages/it')).default,
  ru: async () => (await import('@/messages/ru')).default,
  ko: async () => (await import('@/messages/ko')).default,
  tr: async () => (await import('@/messages/tr')).default,
  id: async () => (await import('@/messages/id')).default,
  pl: async () => (await import('@/messages/pl')).default,
  vi: async () => (await import('@/messages/vi')).default,
  hi: async () => (await import('@/messages/hi')).default,
  'pt-BR': async () => (await import('@/messages/pt-BR')).default,
  'zh-CN': async () => (await import('@/messages/zh-CN')).default,
}

/** `fallback` with `override` laid over it, key by key: a missing translation shows English. */
function withFallback(fallback: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...fallback }
  for (const [key, value] of Object.entries(override)) {
    const base = fallback[key]
    out[key] = typeof value === 'object' && typeof base === 'object' ? withFallback(base, value) : value
  }
  return out
}

let pseudoCache: Messages | undefined

/** The full catalog for a locale (callers have already validated it). */
export async function loadMessages(locale: AppLocale): Promise<Messages> {
  if (locale === PSEUDO_LOCALE && PSEUDO_LOCALE_ENABLED) {
    pseudoCache ??= pseudoLocalize(en)
    return pseudoCache
  }
  const load = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE]!
  const messages = await load()
  return (locale === DEFAULT_LOCALE ? messages : withFallback(en, messages)) as Messages
}

/**
 * The parts of the catalog Client Components read (`useTranslations` in a 'use client' file or
 * anything it imports). Only these are serialized into the page for the browser; Server
 * Components read the full catalog on the server, so the long server-only copy (the beta guide,
 * the features page) never ships to the client. Entries are namespaces or dotted sub-namespaces.
 * `__tests__/i18n-client-namespaces.test.ts` fails when a client file reads one not covered here.
 */
export const CLIENT_NAMESPACES = [
  'common',
  'nav',
  'languageSwitcher',
  'errors',
  'demoVideo',
  'reviews',
  'home.pricing',
  'pricing',
  'faq',
  'contact',
  'share',
  'uninstalled.form',
  'dashboard',
  'account.devices',
  'account.password',
  'account.credits',
  'organize',
  'beta.interactive',
  'auth',
  'consent',
] as const

/** The client subset of a catalog, for `NextIntlClientProvider`. */
export function clientMessages(messages: Messages): MessageTree {
  const out: MessageTree = {}
  for (const path of CLIENT_NAMESPACES) {
    const parts = path.split('.')
    let source: MessageTree | string | undefined = messages as unknown as MessageTree
    for (const part of parts) source = typeof source === 'object' ? source[part] : undefined
    if (source === undefined) continue
    let target = out
    for (const part of parts.slice(0, -1)) target = (target[part] ??= {}) as MessageTree
    target[parts[parts.length - 1]] = source
  }
  return out
}
