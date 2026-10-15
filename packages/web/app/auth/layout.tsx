import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

// Sign-in, sign-up and password pages have nothing to rank for. They are crawlable on purpose
// (robots.txt doesn't block /auth/): a crawler only sees this noindex if it may fetch the page,
// while a robots.txt Disallow alone can still leave a linked URL listed without its content.
export const metadata: Metadata = { robots: NOINDEX }

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
