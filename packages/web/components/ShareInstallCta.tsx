import { useTranslations } from 'next-intl'
import { STORE_ICON } from '@/components/marketing/BrowserIcons'
import { StoreLink } from '@/components/StoreLink'
import { getStoreLinks } from '@/lib/storeLinks'
import type { InstallBrowser } from '@/lib/visitorBrowser'

interface ShareInstallCtaProps {
  /** The visitor's browser (`getVisitorBrowser()` on the page): the button installs for it. Defaults to Chrome. */
  browser?: InstallBrowser
}

export function ShareInstallCta({ browser = 'chrome' }: ShareInstallCtaProps = {}) {
  // Server component: the links follow the deployment answering this request.
  const storeLinks = getStoreLinks()
  const t = useTranslations('share')
  const Icon = STORE_ICON[browser]

  return (
    <div className="mt-8 rounded-2xl border border-dashed border-border2 p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
      <div className="flex-1">
        <p className="font-semibold text-[14.5px] mb-0.5">{t('ctaTitle')}</p>
        <p className="text-[13px] text-text2">{t('ctaBody')}</p>
      </div>
      <StoreLink
        href={storeLinks[browser]}
        className="shrink-0 inline-flex items-center gap-2 h-10 px-5 rounded-md text-white text-[13.5px] font-medium shadow-sh2 hover:shadow-sh3 hover:-translate-y-px transition-all"
        style={{ backgroundImage: 'var(--gradient-brand)' }}
      >
        <Icon size={16} />
        {t('installFree')}
      </StoreLink>
    </div>
  )
}
