/**
 * Translations in tests. `vitest.setup.tsx` uses these so every test renders with the English
 * catalog without wiring it up itself:
 * - `IntlWrapper` is RTL's default `wrapper` (composed with a test's own wrapper), so Client
 *   Components calling `useTranslations` find a `NextIntlClientProvider`.
 * - `serverIntlMock` replaces `next-intl/server`, whose real functions only run inside a Next
 *   request, so async Server Components and `generateMetadata` render in jsdom.
 */
import React from 'react'
import { NextIntlClientProvider, createFormatter, createTranslator } from 'next-intl'
import en from '@/messages/en'
import { DEFAULT_LOCALE } from '@/i18n/locales'

export const TEST_LOCALE = DEFAULT_LOCALE
export const testMessages = en

export function IntlWrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={TEST_LOCALE} messages={en}>
      {children}
    </NextIntlClientProvider>
  )
}

type Wrapper = React.JSXElementConstructor<{ children: React.ReactNode }>

/** The intl provider around a test's own wrapper (if it passed one). */
export function withIntlWrapper(inner?: Wrapper): Wrapper {
  if (!inner) return IntlWrapper
  const Inner = inner
  return function ComposedWrapper({ children }: { children: React.ReactNode }) {
    return (
      <IntlWrapper>
        <Inner>{children}</Inner>
      </IntlWrapper>
    )
  }
}

type NamespaceArg = string | { locale?: string; namespace?: string } | undefined

function namespaceOf(arg: NamespaceArg): string | undefined {
  return typeof arg === 'string' ? arg : arg?.namespace
}

/**
 * Stand-in for `@/i18n/navigation` (next-intl's `createNavigation`): on the default locale its
 * `Link` is `next/link` with the same `href`. Built when a test first imports the module, so a
 * test's own `next/link` mock applies. Kept separate from the `next/navigation` mock, which many
 * tests replace with their own.
 */
export const createNavigationMock = (NextLink: React.ComponentType<{ href: string; children?: React.ReactNode }>) => ({
  Link: ({
    children,
    href,
    locale: _locale,
    ...props
  }: { children?: React.ReactNode; href: string; locale?: string; [key: string]: unknown }) => (
    <NextLink href={href} {...props}>
      {children}
    </NextLink>
  ),
  redirect: ({ href }: { href: string }) => {
    throw new Error(`NEXT_REDIRECT;replace;${href};307;`)
  },
  getPathname: ({ href }: { href: string }) => href,
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {}, back: () => {}, forward: () => {} }),
})

/** Stand-ins for `next-intl/server` with the English catalog. */
export const serverIntlMock = {
  getTranslations: async (arg?: NamespaceArg) =>
    createTranslator({ locale: TEST_LOCALE, messages: en, namespace: namespaceOf(arg) as never }),
  getLocale: async () => TEST_LOCALE,
  getMessages: async () => en,
  getFormatter: async () => createFormatter({ locale: TEST_LOCALE }),
  getNow: async () => new Date(),
  getTimeZone: async () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  setRequestLocale: () => {},
}
