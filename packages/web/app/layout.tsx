import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { ThemeProvider } from '@/components/theme-provider'
import { AppToaster } from '@/components/AppToaster'
import { PostHogProvider } from '@/components/posthog-provider'
import { DeferredOnLoad } from '@/components/DeferredOnLoad'
import { CookieConsentBanner } from '@/components/consent/CookieConsentBanner'
import { ConsentedGoogleAnalytics } from '@/components/consent/ConsentedGoogleAnalytics'
import { getMetadataBase } from '@/lib/utils'
import { siteMetadata } from '@/lib/seo'
import { clientMessages, type Messages } from '@/i18n/messages'
import { DEFAULT_LOCALE, isAppLocale, localeDirection, type AppLocale } from '@/i18n/locales'
import { noFlashThemeScript } from '@/lib/themeScript'
import './globals.css'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

/**
 * The request's locale: the `[locale]` segment for the translated site (the proxy passes it in a
 * request header), the default locale for routes outside it (`/auth/*`, the root 404).
 */
async function requestLocale(): Promise<AppLocale> {
  const locale = await getLocale()
  return isAppLocale(locale) ? locale : DEFAULT_LOCALE
}

// Fallback cards for pages that set none (the signed-in app, auth, 404). Indexable pages set
// their own through `pageMetadata()` (lib/seo.ts).
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: getMetadataBase(),
    ...(await siteMetadata(await requestLocale())),
    verification: {
      google: 'OW3tfEcFL_xiCb5p0XfnF7B1BILkp-gkxDuNg4XZFK8',
    },
  }
}

/** `lang` and `dir` follow the active locale; Client Components get their namespaces of its catalog. */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await requestLocale()
  const messages = (await getMessages({ locale })) as Messages

  return (
    <html lang={locale} dir={localeDirection(locale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <NextIntlClientProvider locale={locale} messages={clientMessages(messages)}>
          <ThemeProvider>
            {children}
            <AppToaster />
            {/* Asks before Google Analytics and PostHog may use cookies (lib/consent.ts). */}
            <CookieConsentBanner />
          </ThemeProvider>
        </NextIntlClientProvider>
        {/* Measurement loads after the page has, never during it: it needs none of the first
            paint's bandwidth or main-thread time. Both follow the visitor's cookie choice. */}
        <DeferredOnLoad>
          <PostHogProvider />
          {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
            <ConsentedGoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
          )}
        </DeferredOnLoad>
        {/* Vercel Web Analytics + Speed Insights. The `/next` entry points hook
            into the App Router, so client-side navigations are counted as page
            views — the plain `/react` entry would only see the first load.
            Both are cookieless and load same-origin scripts from /_vercel/*.
            They only report once enabled in the Vercel dashboard (Analytics and
            Speed Insights tabs); in local dev they run in debug mode and send
            nothing. */}
        <DeferredOnLoad>
          <Analytics />
          <SpeedInsights />
        </DeferredOnLoad>
      </body>
    </html>
  )
}
