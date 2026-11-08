import { Fragment, type ReactNode } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { StoreLink } from '@/components/StoreLink'
import { STORE_ICON } from '@/components/marketing/BrowserIcons'
import { AI_AVAILABILITY } from '@/lib/aiFlag'
import { getStoreLinks } from '@/lib/storeLinks'
import { STORE_LABEL } from '@/lib/stores'
import type { InstallBrowser } from '@/lib/visitorBrowser'
import { COMPARE_RICH_TAGS } from './richText'
import { COMPARISON_CHECKED_DATE, COMPARISON_CHECKED_ON, COMPARISON_DATE_FORMAT, COMPETITORS, displayUrl, type Competitor } from '@/lib/comparison'

/**
 * Values for a message with `<time>{date}</time>`: the check date in the page's locale ("Nov 5,
 * 2026"), wrapped in a real `<time>`.
 */
function useCheckedDate() {
  const format = useFormatter()
  return {
    date: format.dateTime(COMPARISON_CHECKED_DATE, COMPARISON_DATE_FORMAT),
    time: (chunks: ReactNode) => <time dateTime={COMPARISON_CHECKED_ON}>{chunks}</time>,
  }
}

/** The page's heading, the lead (how many tools are compared), and the "Checked on" stamp. */
export function CompareHero() {
  const t = useTranslations('compare')
  const checkedDate = useCheckedDate()
  return (
    <div className="pb-12 pt-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('title')}</h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground sm:text-xl">
        {t('lead', { count: COMPETITORS.length })}
      </p>
      <p className="mt-5 inline-block border border-border px-2.5 py-1 font-mono text-[0.8125rem] text-text3">
        {t.rich('checkedOn', checkedDate)}
      </p>
    </div>
  )
}

const DIFFERENCES = ['e2ee', 'ai', 'import'] as const

/** The three things that set TabMerger apart, as numbered cards. */
export function CompareDifferences() {
  const t = useTranslations('compare.differences')
  // The AI card says what's live: both options, the own-key option alone, or "coming soon".
  const aiDescription = !AI_AVAILABILITY.any
    ? t('ai.descriptionComingSoon')
    : AI_AVAILABILITY.managed
      ? t('ai.description')
      : t('ai.descriptionOwnKey')
  return (
    <section aria-labelledby="compare-differences" className="mb-16">
      <h2 id="compare-differences" className="sr-only">
        {t('label')}
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        {DIFFERENCES.map((key, i) => (
          <div key={key} className="border border-border bg-card p-6">
            <div className="font-mono text-[0.8125rem] font-medium text-primary">{String(i + 1).padStart(2, '0')}</div>
            <h3 className="mb-1.5 mt-2 text-[1.1875rem] font-semibold tracking-tight">{t(`${key}.title`)}</h3>
            <p className="text-[0.90625rem] leading-relaxed text-text2">
              {key === 'ai' ? aiDescription : t.rich(`${key}.description`, COMPARE_RICH_TAGS)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The "Add to <browser>" label for each browser (the features page's buttons). */
const ADD_TO_LABEL = {
  chrome: 'addToChrome',
  firefox: 'addToFirefox',
  edge: 'addToEdge',
} as const satisfies Record<InstallBrowser, string>

const SWITCH_STEPS = ['export', 'save', 'open', 'import', 'other'] as const

/** "Switching from OneTab?": how a OneTab export becomes groups, with the install button. */
export function SwitchingFromOneTab({ browser }: { browser: InstallBrowser }) {
  const t = useTranslations('compare.switching')
  const features = useTranslations('featuresPage')
  const storeLinks = getStoreLinks()
  const BrowserIcon = STORE_ICON[browser]
  const bold = (chunks: ReactNode) => <b className="font-semibold text-foreground">{chunks}</b>
  return (
    <section
      aria-labelledby="compare-switching"
      className="mt-16 grid items-start gap-6 border border-border bg-surface2 p-6 md:mt-[4.5rem] md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-12 md:p-10"
    >
      <div>
        <h2 id="compare-switching" className="text-3xl font-bold tracking-tight">
          {t('title')}
        </h2>
        <p className="mt-2 text-[1.0625rem] text-text2">{t('lead')}</p>
        <Button size="lg" className="mt-6 h-auto min-h-11 max-w-full gap-2 whitespace-normal py-2 text-center" asChild>
          <StoreLink href={storeLinks[browser]}>
            <BrowserIcon size={18} />
            {features(ADD_TO_LABEL[browser])}
          </StoreLink>
        </Button>
      </div>
      <ol className="flex flex-col gap-3.5">
        {SWITCH_STEPS.map((step, i) => (
          <li key={step} className="grid grid-cols-[2rem_minmax(0,1fr)] text-[0.9375rem] leading-normal text-text2">
            <span aria-hidden="true" className="pt-[0.15rem] font-mono text-[0.8125rem] text-primary">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{t.rich(`steps.${step}`, { b: bold, ...COMPARE_RICH_TAGS })}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** An external source link: a new tab, no ranking credit, no referrer. */
function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  const common = useTranslations('common')
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="underline underline-offset-2 transition-colors hover:text-foreground"
    >
      {children}
      <span className="sr-only">{common('opensInNewTab')}</span>
    </a>
  )
}

/** One competitor's sources: its official pages (as addresses) and its store listing. */
function SourceList({ competitor }: { competitor: Competitor }) {
  return (
    <li>
      <b className="mb-1 block font-semibold text-text2">{competitor.name}</b>
      {competitor.siteUrls?.map((url) => (
        <Fragment key={url}>
          <SourceLink href={url}>
            <span dir="ltr">{displayUrl(url)}</span>
          </SourceLink>
          {' · '}
        </Fragment>
      ))}
      <SourceLink href={competitor.storeUrl}>{STORE_LABEL[competitor.store]}</SourceLink>
    </li>
  )
}

/** Where the facts come from and when they were checked, the trademark note, and each product's sources. */
export function CompareSources() {
  const t = useTranslations('compare')
  const pricing = useTranslations('pricing')
  const checkedDate = useCheckedDate()
  return (
    <section aria-labelledby="compare-sources" className="mt-12 border-t border-border pt-6 text-[0.8125rem] leading-relaxed text-text3">
      <p>
        {t.rich('fairUse', {
          ...checkedDate,
          link: (chunks) => (
            <Link href="/contact" className="underline underline-offset-2 transition-colors hover:text-foreground">
              {chunks}
            </Link>
          ),
        })}{' '}
        {pricing('usdNote')}
      </p>
      <h2 id="compare-sources" className="sr-only">
        {t('sources.label')}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {COMPETITORS.map((competitor) => (
          <SourceList key={competitor.id} competitor={competitor} />
        ))}
      </ul>
    </section>
  )
}
