import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

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
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
