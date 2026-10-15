import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

// Shared bundles are unlisted links to one person's tabs, not pages for search results. Like the
// auth pages they are crawlable (robots.txt doesn't block /share/) so this noindex can be seen.
export const metadata: Metadata = { robots: NOINDEX }

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children
}
