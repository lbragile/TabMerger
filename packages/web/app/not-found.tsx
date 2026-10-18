import type { Metadata } from 'next'
import { House } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/button'
import { ErrorPageShell } from '@/components/errors/ErrorPageShell'
import { SITE_LINKS } from '@/components/errors/copy'
import { Link } from '@/i18n/navigation'

// No `robots` here: Next already adds `<meta name="robots" content="noindex">` to every 404, and
// a page-level one would be a second copy of the same tag.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors')
  return { title: t('notFound.documentTitle') }
}

/**
 * The 404 page, for unmatched URLs and every `notFound()` call (no segment has its own
 * not-found), in the request's locale. It renders under the root layout only, so it brings the
 * marketing Navbar and Footer itself: a visitor who hit a dead link can still get anywhere on the
 * site.
 */
export default function NotFound() {
  const t = useTranslations('errors')
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <ErrorPageShell
        as="main"
        kind="notFound"
        links={SITE_LINKS}
        actions={
          <Button size="lg" asChild>
            <Link href="/">
              <House className="h-4 w-4" aria-hidden="true" />
              {t('backToHome')}
            </Link>
          </Button>
        }
      />
      <Footer />
    </div>
  )
}
