'use client'

import { useEffect } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { ErrorHeader } from '@/components/errors/ErrorHeader'
import { ErrorBoundaryView, type ErrorBoundaryProps } from '@/components/errors/ErrorBoundaryView'
import { applyStoredTheme, noFlashThemeScript } from '@/lib/themeScript'
import { DEFAULT_LOCALE } from '@/i18n/locales'
// Only this namespace: the 500 page is part of every route's bundle.
import errors from '@/messages/en/errors.json'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

/**
 * Last-resort 500 page, shown when the root layout itself fails. It replaces that layout, so it
 * renders its own `<html>`/`<body>` and brings its own styles, fonts and theme: nothing from the
 * root layout (theme provider, toaster, analytics) is available. Links are plain anchors so
 * leaving the page is a full load. The error is still reported to Sentry by ErrorBoundaryView.
 *
 * It can't know the request's locale (the layout that does is what failed), so it speaks the
 * default locale, with only the `errors` namespace bundled (not the whole catalog).
 */
export default function GlobalError(props: ErrorBoundaryProps) {
  // The inline script sets the theme when this page is server-rendered; when the root layout
  // fails in the browser instead, React renders this document and the script doesn't run.
  useEffect(() => applyStoredTheme(), [])

  return (
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{ errors }}>
          <div className="flex min-h-screen flex-col">
            <ErrorHeader plainLinks />
            <ErrorBoundaryView {...props} context="global" as="main" />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
