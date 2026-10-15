import type { Metadata } from 'next'
import Link from 'next/link'
import { House } from 'lucide-react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/button'
import { ErrorPageShell } from '@/components/errors/ErrorPageShell'
import { NOT_FOUND_COPY, SITE_LINKS } from '@/components/errors/copy'

export const metadata: Metadata = {
  title: NOT_FOUND_COPY.documentTitle,
  robots: { index: false },
}

/**
 * The 404 page, for unmatched URLs and every `notFound()` call (no segment has its own
 * not-found). It renders under the root layout only, so it brings the marketing Navbar and
 * Footer itself: a visitor who hit a dead link can still get anywhere on the site.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <ErrorPageShell
        as="main"
        copy={NOT_FOUND_COPY}
        variant="lost"
        links={SITE_LINKS}
        actions={
          <Button size="lg" asChild>
            <Link href="/">
              <House className="h-4 w-4" aria-hidden="true" />
              Back to home
            </Link>
          </Button>
        }
      />
      <Footer />
    </div>
  )
}
