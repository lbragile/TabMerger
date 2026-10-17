import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ChromeIcon, FirefoxIcon, EdgeIcon } from './BrowserIcons'
import { DemoSection } from './DemoSection'
import { StoreLink } from '@/components/StoreLink'
import { getStoreLinks } from '@/lib/storeLinks'
import { orderInstallBrowsers, type InstallBrowser } from '@/lib/visitorBrowser'

/** Each browser's icon and its `home.hero` message keys: the large-button label and the short name. */
const BROWSER_LABELS = {
  chrome: { Icon: ChromeIcon, install: 'installChrome', name: 'chrome' },
  firefox: { Icon: FirefoxIcon, install: 'installFirefox', name: 'firefox' },
  edge: { Icon: EdgeIcon, install: 'installEdge', name: 'edge' },
} as const

interface HeroProps {
  /**
   * The visitor's browser (`getVisitorBrowser()` on the page): it gets the large primary
   * button, the others the small outline ones. All three always show. Defaults to Chrome.
   */
  browser?: InstallBrowser
}

export function Hero({ browser = 'chrome' }: HeroProps = {}) {
  // Server component: the links follow the deployment answering this request.
  const storeLinks = getStoreLinks()
  const t = useTranslations('home.hero')

  return (
    <section className="py-14 px-8 bg-background">
      <div className="container">
        {/* Two columns from `lg` only: at tablet widths half the row is too narrow for a
            16:9 video, so it stacks under the copy at full width instead. */}
        <div className="grid gap-10 items-center grid-cols-1 lg:grid-cols-[1fr_1fr]">
          {/* Left col — capped width + ml-auto pulls the text block toward the
              center gutter instead of hugging the far-left edge of the section. */}
          <div className="flex flex-col lg:max-w-[34rem] lg:ml-auto">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              {t('eyebrow')}
            </p>
            <h1
              className="font-bold text-foreground mb-4 text-4xl md:text-[52px]"
              style={{ letterSpacing: '-0.02em', lineHeight: 1.02 }}
            >
              {t('title')}
            </h1>
            <p className="text-base text-muted-foreground mb-6" style={{ maxWidth: '38ch' }}>
              {t('lead')}
            </p>

            {/* CTA row: the visitor's browser first */}
            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              {orderInstallBrowsers(browser).map((b, i) => {
                const { Icon, install, name } = BROWSER_LABELS[b]
                return i === 0 ? (
                  // Wraps instead of running off a phone screen when the label is long (another
                  // language); one line, at the usual 44px, whenever it fits.
                  <Button key={b} size="lg" className="gap-2 h-auto min-h-11 max-w-full whitespace-normal py-2 text-center" asChild>
                    <StoreLink href={storeLinks[b]}>
                      <Icon size={18} />
                      {t(install)}
                    </StoreLink>
                  </Button>
                ) : (
                  <Button key={b} size="sm" variant="outline" className="gap-1.5" asChild>
                    <StoreLink href={storeLinks[b]}>
                      <Icon size={15} />
                      {t(name)}
                    </StoreLink>
                  </Button>
                )
              })}
            </div>

            <p className="text-xs text-muted-foreground">{t('note')}</p>
          </div>

          {/* Right col */}
          <div className="relative">
            <DemoSection />
          </div>
        </div>
      </div>
    </section>
  )
}
