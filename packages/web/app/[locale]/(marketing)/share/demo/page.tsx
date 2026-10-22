import { getTranslations } from 'next-intl/server'
import { ShareBundleContent } from '@/components/ShareBundleContent'
import { StoreLink } from '@/components/StoreLink'
import { getStoreLinks } from '@/lib/storeLinks'
import { getVisitorBrowser } from '@/lib/visitorBrowser'

// ponytail: static fixture, no Supabase call — this route must always work for marketing links
const DEMO_BUNDLE = {
  slug: 'demo',
  expiresAt: null,
  groups: [
    {
      id: 'demo-work',
      name: 'Work',
      color: 'rgba(59,130,246,1)',
      windows: [
        {
          id: 1,
          incognito: false,
          focused: false,
          tabs: [
            { id: 1, title: 'GitHub — tabmerger/tabmerger', url: 'https://github.com/', favIconUrl: 'https://www.google.com/s2/favicons?domain=github.com&sz=32' },
            { id: 2, title: 'Linear — Sprint board', url: 'https://linear.app/', favIconUrl: 'https://www.google.com/s2/favicons?domain=linear.app&sz=32' },
            { id: 3, title: 'Notion — Q3 roadmap', url: 'https://notion.so/', favIconUrl: 'https://www.google.com/s2/favicons?domain=notion.so&sz=32' },
          ],
        },
      ],
    },
    {
      id: 'demo-research',
      name: 'Research',
      color: 'rgba(34,197,94,1)',
      windows: [
        {
          id: 2,
          incognito: false,
          focused: false,
          tabs: [
            { id: 4, title: 'MDN — CSS Grid', url: 'https://developer.mozilla.org/', favIconUrl: 'https://www.google.com/s2/favicons?domain=developer.mozilla.org&sz=32' },
            { id: 5, title: 'Can I use — Container queries', url: 'https://caniuse.com/', favIconUrl: 'https://www.google.com/s2/favicons?domain=caniuse.com&sz=32' },
          ],
        },
      ],
    },
  ],
}

export default async function ShareDemoPage() {
  // Server component: the links follow the deployment answering this request, and "Install
  // free" installs for the visitor's browser.
  const storeLinks = getStoreLinks()
  const [t, browser] = await Promise.all([getTranslations('share'), getVisitorBrowser()])

  return (
    <main className="max-w-3xl mx-auto px-4 py-14">
      <div className="mb-8">
        <span className="inline-flex items-center h-6 px-2.5 rounded-md bg-surface2 border border-border text-[11.5px] text-text2 mb-3.5">
          {t('badge')}
        </span>
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight mb-2">{t('title')}</h1>
        <p className="text-[13px] text-text2">
          {t('demoNote')}
        </p>
      </div>
      <ShareBundleContent bundle={DEMO_BUNDLE} />
      <div className="mt-8 rounded-2xl border border-dashed border-border2 p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-start">
        <div className="flex-1">
          <p className="font-semibold text-[14.5px] mb-0.5">{t('ctaTitle')}</p>
          <p className="text-[13px] text-text2">{t('ctaBody')}</p>
        </div>
        <StoreLink
          href={storeLinks[browser]}
          className="shrink-0 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[13.5px] font-medium hover:bg-primary/90 transition-colors inline-flex items-center justify-center"
        >
          {t('installFree')}
        </StoreLink>
      </div>
    </main>
  )
}
