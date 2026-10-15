import type { Metadata } from 'next'
import { GoogleAnalytics } from '@next/third-parties/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { AppToaster } from '@/components/AppToaster'
import { PostHogProvider } from '@/components/posthog-provider'
import { DeferredOnLoad } from '@/components/DeferredOnLoad'
import { getMetadataBase } from '@/lib/utils'
import { HOME_TITLE, SITE_DESCRIPTION, SITE_NAME, TITLE_TEMPLATE } from '@/lib/seo'
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

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: {
    default: HOME_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'tab manager',
    'browser extension',
    'productivity',
    'chrome extension',
    'tab organizer',
  ],
  // Fallback cards for pages that set none (the signed-in app, auth, 404). Indexable pages set
  // their own through `pageMetadata()` (lib/seo.ts): Next replaces these objects whole, it does
  // not merge them. No `url` here: one URL for every page is what made all pages share as the
  // homepage.
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: SITE_NAME,
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
  },
  verification: {
    google: 'OW3tfEcFL_xiCb5p0XfnF7B1BILkp-gkxDuNg4XZFK8',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <ThemeProvider>
          {children}
          <AppToaster />
        </ThemeProvider>
        {/* Measurement loads after the page has, never during it: it needs none of the first
            paint's bandwidth or main-thread time. */}
        <DeferredOnLoad>
          <PostHogProvider />
          {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
            <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
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
