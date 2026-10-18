import { getTranslations } from 'next-intl/server'
import { pageMetadata } from '@/lib/seo'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AI_ENABLED } from '@/lib/aiFlag'
import { AUTO_BACKUP_RETENTION_COUNT, FREE_TIER_LIMITS } from '@tabmerger/shared'
import { getStoreLinks } from '@/lib/storeLinks'
import { STORE_ICON } from '@/components/marketing/BrowserIcons'
import { StoreLink } from '@/components/StoreLink'
import { getVisitorBrowser, type InstallBrowser } from '@/lib/visitorBrowser'
import {
  Layers,
  Search,
  Zap,
  Cloud,
  Brain,
  Download,
  GripVertical,
  Keyboard,
  RefreshCw,
  Shield,
  ArrowRight,
  History,
  type LucideIcon,
} from 'lucide-react'

export async function generateMetadata() {
  const t = await getTranslations('featuresPage')
  return pageMetadata({ path: '/features', title: t('metaTitle'), description: t('metaDescription') })
}

/** A section's key under `featuresPage` (its badge, title, description and features). */
type SectionKey = 'core' | 'pro' | 'proAi'

const badgeStyle: Record<SectionKey, string> = {
  core: 'bg-muted text-muted-foreground',
  pro: 'bg-primary/10 text-primary',
  proAi: 'bg-secondary/10 text-[hsl(33_90%_28%)] dark:text-secondary',
}

/**
 * Each feature is a key under its section (`featuresPage.<section>.<key>.title|description`).
 * `count` fills the description's `{count}` (a limit from `@tabmerger/shared`).
 */
const featureSections: { key: SectionKey; features: { key: string; icon: LucideIcon; count?: number }[] }[] = [
  {
    key: 'core',
    features: [
      { key: 'groups', icon: Layers },
      { key: 'search', icon: Search },
      { key: 'dnd', icon: GripVertical },
      { key: 'shortcuts', icon: Keyboard },
      { key: 'importExport', icon: Download },
      { key: 'memory', icon: Zap },
    ],
  },
  {
    key: 'pro',
    features: [
      { key: 'cloudSync', icon: Cloud },
      { key: 'sessions', icon: RefreshCw, count: FREE_TIER_LIMITS.sessions },
      { key: 'autoBackups', icon: History, count: AUTO_BACKUP_RETENTION_COUNT },
      { key: 'support', icon: Shield },
    ],
  },
  {
    key: 'proAi',
    features: [
      { key: 'autoGrouping', icon: Brain },
      { key: 'names', icon: Layers },
      { key: 'summaries', icon: Search },
      { key: 'sessionSuggestions', icon: RefreshCw },
    ],
  },
]

/** The header button's label for each browser. */
const ADD_TO_LABEL = {
  chrome: 'addToChrome',
  firefox: 'addToFirefox',
  edge: 'addToEdge',
} as const satisfies Record<InstallBrowser, string>

export default async function FeaturesPage() {
  // Server component: the links follow the deployment answering this request, and the button
  // installs for the visitor's browser (read here so the first HTML is already right). Async, so
  // the translations come from `getTranslations` (hooks can't run in an async component).
  const storeLinks = getStoreLinks()
  const [t, common, browser] = await Promise.all([
    getTranslations('featuresPage'),
    getTranslations('common'),
    getVisitorBrowser(),
  ])
  const BrowserIcon = STORE_ICON[browser]
  // Feature keys come from the list above (a test renders every one). Messages without a
  // `{count}` ignore the value.
  const featureText = (path: string, count = 0) => t(path as 'pro.sessions.description', { count })

  return (
    <div className="py-16">
      <div className="container">
        {/* Header */}
        <div className="text-center mb-20">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-4 text-xl text-muted-foreground max-w-2xl mx-auto">
            {t('lead')}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="gap-2" asChild>
              <StoreLink href={storeLinks[browser]}>
                <BrowserIcon size={18} />
                {t(ADD_TO_LABEL[browser])}
              </StoreLink>
            </Button>
            <Button variant="outline" size="lg" className="gap-2" asChild>
              <Link href="/pricing">
                {t('seePricing')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Feature sections — numbered rows, same format as the homepage teaser */}
        <div className="flex flex-col gap-16 max-w-[960px] mx-auto">
          {featureSections.map((section) => {
            const isAi = section.key === 'proAi'
            const rows = (
              <div className="flex flex-col divide-y divide-border">
                {section.features.map((feature, i) => {
                  const Icon = feature.icon
                  return (
                    <div
                      key={feature.key}
                      className="grid grid-cols-1 sm:grid-cols-[64px_1fr_auto] gap-4 sm:gap-8 py-6 items-start"
                    >
                      <div className="font-mono text-[13px] font-medium text-primary">
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <h3 className="font-semibold text-[19px] tracking-tight mb-1.5">{featureText(`${section.key}.${feature.key}.title`)}</h3>
                        <p className="text-[14.5px] leading-relaxed text-text2">{featureText(`${section.key}.${feature.key}.description`, feature.count)}</p>
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 shrink-0">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
            return (
              <div key={section.key}>
                <div className="mb-2">
                  <span className={cn('inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold mb-3', badgeStyle[section.key])}>
                    {t(`badges.${section.key}`)}
                  </span>
                  {isAi && !AI_ENABLED && (
                    <span className="ml-2 inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold mb-3 bg-muted text-muted-foreground">
                      {common('comingSoon')}
                    </span>
                  )}
                  <h2 className="text-3xl font-bold tracking-tight">
                    {t(`${section.key}.title`)}
                  </h2>
                  <p className="mt-2 text-lg text-text2 max-w-xl">
                    {t(`${section.key}.description`)}
                  </p>
                </div>
                {isAi ? (
                  <div className="rounded-md p-8 bg-surface2 border border-border">{rows}</div>
                ) : (
                  rows
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
