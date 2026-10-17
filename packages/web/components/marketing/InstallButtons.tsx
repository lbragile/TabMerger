import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { ChromeIcon, FirefoxIcon, EdgeIcon } from './BrowserIcons'
import { StoreLink } from '@/components/StoreLink'
import { getStoreLinks } from '@/lib/storeLinks'
import { cn } from '@/lib/utils'
import { orderInstallBrowsers, type InstallBrowser } from '@/lib/visitorBrowser'

/** Each browser's icon and its `home.install` button label key. */
const BROWSER_LABELS = {
  chrome: { Icon: ChromeIcon, label: 'addToChrome' },
  firefox: { Icon: FirefoxIcon, label: 'addToFirefox' },
  edge: { Icon: EdgeIcon, label: 'addToEdge' },
} as const

interface InstallButtonsProps {
  /**
   * The visitor's browser (`getVisitorBrowser()` on the page): its button comes first, filled;
   * the others follow as outlines. All three always show. Defaults to Chrome.
   */
  browser?: InstallBrowser
}

export function InstallButtons({ browser = 'chrome' }: InstallButtonsProps = {}) {
  // Server component: the links follow the deployment answering this request.
  const storeLinks = getStoreLinks()
  const t = useTranslations('home.install')

  return (
    <section className="py-24">
      <div className="container">
        <div className="rounded-2xl bg-primary px-8 py-16 text-center text-primary-foreground">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t('title')}
          </h2>
          <p className="mt-4 text-lg opacity-80 max-w-xl mx-auto">
            {t('lead')}
          </p>

          {/* Browser install buttons: the visitor's browser first */}
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            {orderInstallBrowsers(browser).map((b, i) => {
              const { Icon, label } = BROWSER_LABELS[b]
              return (
                <StoreLink
                  key={b}
                  href={storeLinks[b]}
                  data-primary={i === 0 ? '' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors',
                    i === 0
                      ? 'bg-white text-gray-900 hover:bg-gray-50 shadow-xs'
                      : 'border border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10'
                  )}
                >
                  <Icon size={20} />
                  {t(label)}
                </StoreLink>
              )
            })}
          </div>

          {/* Secondary CTA */}
          <div className="mt-6">
            <Button
              size="lg"
              variant="outline"
              className="gap-2 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10"
              asChild
            >
              <Link href="/pricing">
                {t('viewPricing')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <p className="mt-4 text-xs opacity-50">
            {t('note')}
          </p>
        </div>
      </div>
    </section>
  )
}
