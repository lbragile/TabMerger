import type { Metadata } from 'next'
import { GoogleAnalytics } from '@next/third-parties/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { AppToaster } from '@/components/AppToaster'
import { PostHogProvider } from '@/components/posthog-provider'
import './globals.css'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

// ponytail: inline script (not a hook) so the class lands before first paint —
// a React effect would run after hydration and flash the wrong theme.
const noFlashThemeScript = `
try {
  var t = localStorage.getItem('theme');
  if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if (t === 'dark') document.documentElement.classList.add('dark');
} catch (e) {}
`

export const metadata: Metadata = {
  title: {
    default: 'TabMerger — Organize your tabs. Reclaim your focus.',
    template: '%s | TabMerger',
  },
  description:
    'TabMerger groups your open tabs into a clean, searchable panel — saving memory and mental bandwidth.',
  keywords: [
    'tab manager',
    'browser extension',
    'productivity',
    'chrome extension',
    'tab organizer',
  ],
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_APP_URL,
    siteName: 'TabMerger',
    title: 'TabMerger — Organize your tabs. Reclaim your focus.',
    description:
      'TabMerger groups your open tabs into a clean, searchable panel — saving memory and mental bandwidth.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TabMerger — Organize your tabs. Reclaim your focus.',
    description:
      'TabMerger groups your open tabs into a clean, searchable panel — saving memory and mental bandwidth.',
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
        <PostHogProvider />
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
        )}
        {/* Vercel Web Analytics + Speed Insights. The `/next` entry points hook
            into the App Router, so client-side navigations are counted as page
            views — the plain `/react` entry would only see the first load.
            Both are cookieless and load same-origin scripts from /_vercel/*.
            They only report once enabled in the Vercel dashboard (Analytics and
            Speed Insights tabs); in local dev they run in debug mode and send
            nothing. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
