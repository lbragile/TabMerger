import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { STORE_ICON } from './BrowserIcons'
import { StoreLink } from '@/components/StoreLink'
import { AI_ENABLED } from '@/lib/aiFlag'
import { getStoreLinks } from '@/lib/storeLinks'
import type { InstallBrowser } from '@/lib/visitorBrowser'

/** The `home.finalCta` button label for each browser. */
const INSTALL_LABEL = {
  chrome: 'installChrome',
  firefox: 'installFirefox',
  edge: 'installEdge',
} as const satisfies Record<InstallBrowser, string>

interface FinalCtaProps {
  /** The visitor's browser (`getVisitorBrowser()` on the page): the button installs for it. Defaults to Chrome. */
  browser?: InstallBrowser
}

export function FinalCta({ browser = 'chrome' }: FinalCtaProps = {}) {
  // Server component: the links follow the deployment answering this request.
  const storeLinks = getStoreLinks()
  const t = useTranslations('home.finalCta')
  const Icon = STORE_ICON[browser]

  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 bg-surface2">
      <div className="container max-w-[720px] text-center">
        <h2 className="font-semibold tracking-tight mb-3 text-[28px] sm:text-[34px] leading-tight">
          {t('title')}
        </h2>
        <p className="text-text2 mb-7 text-[15.5px]">
          {AI_ENABLED ? t('leadAi') : t('leadNoAi')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" className="gap-2" asChild>
            <StoreLink href={storeLinks[browser]}>
              <Icon size={18} />
              {t(INSTALL_LABEL[browser])}
            </StoreLink>
          </Button>
          <Link href="/faq" className="text-[13.5px] text-text2 hover:text-primary transition-colors">
            {t('faq')}
          </Link>
        </div>
      </div>
    </section>
  )
}
