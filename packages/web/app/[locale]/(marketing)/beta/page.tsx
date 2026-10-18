import type { Metadata } from 'next'
import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LegalToc } from '@/components/legal-toc'
import {
  FREE_TIER_LIMITS,
  FIREFOX_BETA,
  CONFLICT_COPY_SUFFIX,
  STORE_LISTING_URL,
  formatUsd,
  getPricingTier,
} from '@tabmerger/shared'
import { KNOWN_ISSUES } from '@/lib/knownIssues'
import { cn } from '@/lib/utils'
import { isProductionDeployment } from '@/lib/deployment'
import { pageMetadata } from '@/lib/seo'
import { BETA_GUIDE_FIREFOX_ID } from '@/lib/storeLinks'
import { GITHUB_DISCUSSIONS_URL, GITHUB_REPO } from '@/lib/github'
import { GitHubMark } from '@/components/GitHubMark'
import { BetaAreaProgress, BetaChecklistReset, BetaGoodCheck, BetaStepList } from '@/components/beta/BetaChecklist'
import { FirefoxBetaAutoStart } from '@/components/beta/FirefoxBetaAutoStart'

// Same gate next.config.ts uses to decide whether to rewrite /firefox-beta/* to the Blob store —
// only set on the Preview deployment (see docs/PUBLISHING.md). Reading it directly here (rather
// than threading a prop) keeps this a plain server component with no client/server split needed
// just for one conditional section.
const FIREFOX_BETA_CONFIGURED = Boolean(process.env.FIREFOX_BETA_BLOB_BASE_URL)
const FIREFOX_BETA_XPI_URL = `${FIREFOX_BETA.PATH}/${FIREFOX_BETA.LATEST_XPI_FILE}`

// The tester guide exists on the preview site and in local development only. On the production
// deployment the page answers 404 (see BetaPage below). Rendering per request means the gate
// reads the running deployment's environment rather than a value frozen when the site was built.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  if (isProductionDeployment()) return { robots: { index: false, follow: false } }
  const t = await getTranslations('beta')
  return pageMetadata({ path: '/beta', title: t('metaTitle'), description: t('metaDescription') })
}

/**
 * A message under `beta` and the values it needs. The guide's data below (areas, items, test
 * cards, the contents list) names its copy this way; `BetaPage` translates it per request.
 */
interface Msg {
  key: string
  values?: Record<string, string | number>
}

const m = (key: string, values?: Msg['values']): Msg => ({ key, values })

/**
 * Plan prices for copy that names one (`{proMonthly}` and friends in `beta.json`), filled from
 * `PRICING_TIERS` so no translation can state a stale price.
 */
const BETA_PRICE_VALUES = {
  proMonthly: formatUsd(getPricingTier('pro').monthlyPrice),
  proYearly: formatUsd(getPricingTier('pro').yearlyPrice),
  proAiMonthly: formatUsd(getPricingTier('pro_ai').monthlyPrice),
} as const

type BetaT = ReturnType<typeof useTranslations<'beta'>>

/** The keys are written by hand in the data below; the beta page test renders every one. */
function translate(t: BetaT, msg: Msg): string {
  return t(msg.key as 'title', msg.values as never)
}

// The Google Group is also the Chrome Web Store trusted-tester list for the private
// BETA item. Joining it is what makes the private listing visible to that Google
// account (access can take a little while to appear after joining).
const BETA_GOOGLE_GROUP_URL = 'https://groups.google.com/g/tabmerger-beta-testers'

// The private BETA item's store listing. It only opens for members of the tester group
// (the Chrome Web Store shows "Item not found" to everyone else).
const BETA_STORE_LISTING_URL = STORE_LISTING_URL.CHROME_BETA

// GitHub Discussions category slugs for this repo. There's no dedicated "Beta" category
// yet — Q&A is used for bug reports (it's "answerable," so a report can be marked
// resolved) and Ideas for feedback/suggestions. Switch BUG to a dedicated category slug
// once the repo owner creates one.
const BETA_BUG_DISCUSSION_CATEGORY = 'q-a'
const BETA_IDEA_DISCUSSION_CATEGORY = 'ideas'

const BUG_REPORT_TEMPLATE = `Summary:
Steps to reproduce:
1.
2.
3.
Expected:
Actual:
Beta version (Settings title badge or chrome://extensions):
Browser and OS:
Signed in: yes / no
Screenshots or screen recording:`

const IDEA_TEMPLATE = `Summary:
What would this help with:
Any workaround you're using today:`

function newDiscussionUrl(category: string, titlePrefix: string, body: string) {
  const params = new URLSearchParams({
    category,
    title: titlePrefix,
    body,
  })
  return `${GITHUB_DISCUSSIONS_URL}/new?${params.toString()}`
}

const BUG_REPORT_DISCUSSION_URL = newDiscussionUrl(
  BETA_BUG_DISCUSSION_CATEGORY,
  '[Beta bug] ',
  BUG_REPORT_TEMPLATE
)
const IDEA_DISCUSSION_URL = newDiscussionUrl(
  BETA_IDEA_DISCUSSION_CATEGORY,
  '[Beta idea] ',
  IDEA_TEMPLATE
)

const TOC: { id: string; label: Msg }[] = [
  { id: 'join', label: m('toc.join.label') },
  { id: 'what-to-test', label: m('toc.what-to-test.label') },
  { id: 'known-issues', label: m('toc.known-issues.label') },
  { id: 'report-bugs', label: m('toc.report-bugs.label') },
  { id: 'faq', label: m('toc.faq.label') },
]

type Example<T = string> =
  | { kind: 'image'; src: string; width: number; height: number; alt: T; caption?: T }
  | { kind: 'ascii'; content: string; caption?: T }
  | { kind: 'testCards'; caption?: T }

const toExamples = <T,>(example: Example<T> | Example<T>[] | undefined): Example<T>[] =>
  example === undefined ? [] : Array.isArray(example) ? example : [example]

// Stripe's published test cards (https://docs.stripe.com/testing). Test mode only:
// a real card is rejected, and none of these ever move money.
const STRIPE_TEST_CARDS: { label: Msg; number: string; note?: Msg }[] = [
  { label: m('testCards.0.label'), number: '4242 4242 4242 4242', note: m('testCards.0.note') },
  { label: m('testCards.1.label'), number: '4000 0000 0000 0002' },
  { label: m('testCards.2.label'), number: '4000 0000 0000 9995' },
  { label: m('testCards.3.label'), number: '4000 0025 0000 3155' },
]

/** A test item with its copy translated (`T = string`), or as written in the data (`T = Msg`). */
type TestItem<T = string> = {
  // Required title above this item's steps, naming the feature (e.g. "Cancelling").
  heading: T
  // Required one-liner under the title: what this item checks, in plain words ("That cancelling
  // keeps Pro until…"), so testers understand the point of the steps before doing them.
  checks: T
  steps: T[]
  // One example, or several shown in order (e.g. the pricing-page button, then Stripe's page).
  example?: Example<T> | Example<T>[]
  // "Good looks like": one entry per outcome a tester can confirm, each with its own checkbox.
  // Keep an explanation or caveat in the same entry as the outcome it qualifies.
  good: T[]
  report?: T
  // Needs a Pro account: `true` for the whole item, or a note saying which part (e.g. "Only the
  // Cloud sync switch needs Pro"). Mirror what the server enforces (sync, sharing, encryption).
  pro?: true | T
}

/**
 * "Pro" / "Partly Pro" chip on test items, and "Pro" / "Some Pro" on their area's header. The
 * visible word is the whole accessible text (no hidden extra words: they got copied along with
 * the sentence around them); the explanation is in the legend above the areas and in `title`.
 */
function ProBadge({ partial, scope = 'item' }: { partial: boolean; scope?: 'item' | 'area' }) {
  const t = useTranslations('beta.proBadge')
  const label = partial ? (scope === 'area' ? t('somePro') : t('partlyPro')) : t('pro')
  const title = partial
    ? scope === 'area'
      ? t('areaPartial')
      : t('itemPartial')
    : scope === 'area'
      ? t('areaAll')
      : t('itemAll')
  return (
    <span
      title={title}
      className={cn(
        'inline-block rounded-none px-1.5 py-px align-middle text-[0.6875rem] font-semibold normal-case tracking-normal',
        partial ? 'border border-primary text-primary' : 'bg-primary text-primary-foreground'
      )}
    >
      {label}
    </span>
  )
}

type AreaAccess = 'free' | 'upgrading' | 'some-pro' | 'pro'

/** Which group a test area is listed under; TEST_AREAS is ordered free → upgrading → some Pro → Pro. */
function areaAccess(area: { id: string; items: { pro?: unknown }[] }): AreaAccess {
  if (area.id === 'upgrading-to-pro') return 'upgrading'
  if (area.items.every((item) => item.pro === true)) return 'pro'
  return area.items.some((item) => item.pro) ? 'some-pro' : 'free'
}

const AREA_ACCESS_LABELS: Record<AreaAccess, Msg> = {
  free: m('accessLabels.free'),
  upgrading: m('accessLabels.upgrading'),
  'some-pro': m('accessLabels.some-pro'),
  pro: m('accessLabels.pro'),
}

const TEST_AREAS: {
  id: string
  title: Msg
  intro?: Msg
  items: TestItem<Msg>[]
}[] = [
  {
    id: 'groups-and-tabs',
    title: m('areas.groups-and-tabs.title'),
    items: [
      {
        heading: m('areas.groups-and-tabs.items.0.heading'),
        checks: m('areas.groups-and-tabs.items.0.checks'),
        steps: [
          m('areas.groups-and-tabs.items.0.steps.0'),
          m('areas.groups-and-tabs.items.0.steps.1'),
          m('areas.groups-and-tabs.items.0.steps.2'),
          m('areas.groups-and-tabs.items.0.steps.3'),
        ],
        example: {
          kind: 'image',
          src: '/beta/color-new-group.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.groups-and-tabs.items.0.examples.0.alt'),
          caption: m('areas.groups-and-tabs.items.0.examples.0.caption'),
        },
        good: [
          m('areas.groups-and-tabs.items.0.good.0'),
          m('areas.groups-and-tabs.items.0.good.1'),
          m('areas.groups-and-tabs.items.0.good.2'),
          m('areas.groups-and-tabs.items.0.good.3'),
        ],
      },
      {
        heading: m('areas.groups-and-tabs.items.1.heading'),
        checks: m('areas.groups-and-tabs.items.1.checks'),
        steps: [
          m('areas.groups-and-tabs.items.1.steps.0'),
          m('areas.groups-and-tabs.items.1.steps.1'),
          m('areas.groups-and-tabs.items.1.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/now-open.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.groups-and-tabs.items.1.examples.0.alt'),
          caption: m('areas.groups-and-tabs.items.1.examples.0.caption'),
        },
        good: [
          m('areas.groups-and-tabs.items.1.good.0'),
          m('areas.groups-and-tabs.items.1.good.1'),
        ],
      },
      {
        heading: m('areas.groups-and-tabs.items.2.heading'),
        checks: m('areas.groups-and-tabs.items.2.checks'),
        steps: [
          m('areas.groups-and-tabs.items.2.steps.0'),
          m('areas.groups-and-tabs.items.2.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/multi-window.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.groups-and-tabs.items.2.examples.0.alt'),
          caption: m('areas.groups-and-tabs.items.2.examples.0.caption'),
        },
        good: [
          m('areas.groups-and-tabs.items.2.good.0'),
        ],
      },
      {
        heading: m('areas.groups-and-tabs.items.3.heading'),
        checks: m('areas.groups-and-tabs.items.3.checks'),
        steps: [
          m('areas.groups-and-tabs.items.3.steps.0'),
          m('areas.groups-and-tabs.items.3.steps.1'),
          m('areas.groups-and-tabs.items.3.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/archive-section.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.groups-and-tabs.items.3.examples.0.alt'),
          caption: m('areas.groups-and-tabs.items.3.examples.0.caption'),
        },
        good: [
          m('areas.groups-and-tabs.items.3.good.0'),
          m('areas.groups-and-tabs.items.3.good.1'),
        ],
      },
      {
        heading: m('areas.groups-and-tabs.items.4.heading'),
        checks: m('areas.groups-and-tabs.items.4.checks'),
        steps: [
          m('areas.groups-and-tabs.items.4.steps.0'),
          m('areas.groups-and-tabs.items.4.steps.1'),
          m('areas.groups-and-tabs.items.4.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/sessions-section.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.groups-and-tabs.items.4.examples.0.alt'),
          caption: m('areas.groups-and-tabs.items.4.examples.0.caption'),
        },
        good: [
          m('areas.groups-and-tabs.items.4.good.0'),
        ],
      },
      {
        heading: m('areas.groups-and-tabs.items.5.heading'),
        checks: m('areas.groups-and-tabs.items.5.checks'),
        steps: [
          m('areas.groups-and-tabs.items.5.steps.0'),
          m('areas.groups-and-tabs.items.5.steps.1'),
          m('areas.groups-and-tabs.items.5.steps.2'),
          m('areas.groups-and-tabs.items.5.steps.3'),
        ],
        example: {
          kind: 'image',
          src: '/beta/search-filter.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.groups-and-tabs.items.5.examples.0.alt'),
          caption: m('areas.groups-and-tabs.items.5.examples.0.caption'),
        },
        good: [
          m('areas.groups-and-tabs.items.5.good.0'),
          m('areas.groups-and-tabs.items.5.good.1'),
          m('areas.groups-and-tabs.items.5.good.2'),
          m('areas.groups-and-tabs.items.5.good.3'),
        ],
      },
      {
        heading: m('areas.groups-and-tabs.items.6.heading'),
        checks: m('areas.groups-and-tabs.items.6.checks'),
        steps: [
          m('areas.groups-and-tabs.items.6.steps.0'),
          m('areas.groups-and-tabs.items.6.steps.1'),
          m('areas.groups-and-tabs.items.6.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/stale-tabs-banner.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.groups-and-tabs.items.6.examples.0.alt'),
          caption: m('areas.groups-and-tabs.items.6.examples.0.caption'),
        },
        good: [
          m('areas.groups-and-tabs.items.6.good.0'),
          m('areas.groups-and-tabs.items.6.good.1'),
        ],
        report: m('areas.groups-and-tabs.items.6.report'),
      },
      {
        heading: m('areas.groups-and-tabs.items.7.heading'),
        checks: m('areas.groups-and-tabs.items.7.checks'),
        steps: [
          m('areas.groups-and-tabs.items.7.steps.0'),
          m('areas.groups-and-tabs.items.7.steps.1'),
          m('areas.groups-and-tabs.items.7.steps.2'),
          m('areas.groups-and-tabs.items.7.steps.3'),
          m('areas.groups-and-tabs.items.7.steps.4'),
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/tab-reminder.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.groups-and-tabs.items.7.examples.0.alt'),
            caption: m('areas.groups-and-tabs.items.7.examples.0.caption'),
          },
          {
            kind: 'image',
            src: '/beta/tab-reminder-set.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.groups-and-tabs.items.7.examples.1.alt'),
            caption: m('areas.groups-and-tabs.items.7.examples.1.caption'),
          },
        ],
        good: [
          m('areas.groups-and-tabs.items.7.good.0'),
          m('areas.groups-and-tabs.items.7.good.1'),
          m('areas.groups-and-tabs.items.7.good.2'),
          m('areas.groups-and-tabs.items.7.good.3'),
          m('areas.groups-and-tabs.items.7.good.4'),
          m('areas.groups-and-tabs.items.7.good.5'),
        ],
        report: m('areas.groups-and-tabs.items.7.report'),
      },
      {
        heading: m('areas.groups-and-tabs.items.8.heading'),
        checks: m('areas.groups-and-tabs.items.8.checks'),
        steps: [
          m('areas.groups-and-tabs.items.8.steps.0'),
          m('areas.groups-and-tabs.items.8.steps.1'),
          m('areas.groups-and-tabs.items.8.steps.2'),
          m('areas.groups-and-tabs.items.8.steps.3'),
          m('areas.groups-and-tabs.items.8.steps.4'),
        ],
        good: [
          m('areas.groups-and-tabs.items.8.good.0'),
          m('areas.groups-and-tabs.items.8.good.1'),
          m('areas.groups-and-tabs.items.8.good.2'),
          m('areas.groups-and-tabs.items.8.good.3'),
        ],
        report: m('areas.groups-and-tabs.items.8.report'),
      },
      {
        heading: m('areas.groups-and-tabs.items.9.heading'),
        checks: m('areas.groups-and-tabs.items.9.checks'),
        steps: [
          m('areas.groups-and-tabs.items.9.steps.0'),
          m('areas.groups-and-tabs.items.9.steps.1'),
          m('areas.groups-and-tabs.items.9.steps.2'),
          m('areas.groups-and-tabs.items.9.steps.3'),
        ],
        good: [
          m('areas.groups-and-tabs.items.9.good.0'),
          m('areas.groups-and-tabs.items.9.good.1'),
          m('areas.groups-and-tabs.items.9.good.2'),
          m('areas.groups-and-tabs.items.9.good.3'),
        ],
        report: m('areas.groups-and-tabs.items.9.report'),
      },
      {
        heading: m('areas.groups-and-tabs.items.10.heading'),
        checks: m('areas.groups-and-tabs.items.10.checks'),
        steps: [
          m('areas.groups-and-tabs.items.10.steps.0'),
          m('areas.groups-and-tabs.items.10.steps.1'),
          m('areas.groups-and-tabs.items.10.steps.2'),
          m('areas.groups-and-tabs.items.10.steps.3'),
          m('areas.groups-and-tabs.items.10.steps.4'),
          m('areas.groups-and-tabs.items.10.steps.5'),
        ],
        good: [
          m('areas.groups-and-tabs.items.10.good.0'),
          m('areas.groups-and-tabs.items.10.good.1'),
          m('areas.groups-and-tabs.items.10.good.2'),
          m('areas.groups-and-tabs.items.10.good.3'),
        ],
        report: m('areas.groups-and-tabs.items.10.report'),
      },
      {
        heading: m('areas.groups-and-tabs.items.11.heading'),
        checks: m('areas.groups-and-tabs.items.11.checks'),
        steps: [
          m('areas.groups-and-tabs.items.11.steps.0'),
          m('areas.groups-and-tabs.items.11.steps.1'),
          m('areas.groups-and-tabs.items.11.steps.2'),
        ],
        good: [
          m('areas.groups-and-tabs.items.11.good.0'),
          m('areas.groups-and-tabs.items.11.good.1'),
          m('areas.groups-and-tabs.items.11.good.2'),
          m('areas.groups-and-tabs.items.11.good.3'),
          m('areas.groups-and-tabs.items.11.good.4'),
        ],
        report: m('areas.groups-and-tabs.items.11.report'),
      },
      {
        heading: m('areas.groups-and-tabs.items.12.heading'),
        checks: m('areas.groups-and-tabs.items.12.checks'),
        steps: [
          m('areas.groups-and-tabs.items.12.steps.0'),
          m('areas.groups-and-tabs.items.12.steps.1'),
          m('areas.groups-and-tabs.items.12.steps.2'),
        ],
        good: [
          m('areas.groups-and-tabs.items.12.good.0'),
          m('areas.groups-and-tabs.items.12.good.1'),
          m('areas.groups-and-tabs.items.12.good.2'),
        ],
      },
    ],
  },
  {
    id: 'right-click-menu',
    title: m('areas.right-click-menu.title'),
    items: [
      {
        heading: m('areas.right-click-menu.items.0.heading'),
        checks: m('areas.right-click-menu.items.0.checks'),
        steps: [
          m('areas.right-click-menu.items.0.steps.0'),
          m('areas.right-click-menu.items.0.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/context-menu.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.right-click-menu.items.0.examples.0.alt'),
          caption: m('areas.right-click-menu.items.0.examples.0.caption'),
        },
        good: [
          m('areas.right-click-menu.items.0.good.0'),
          m('areas.right-click-menu.items.0.good.1'),
        ],
      },
      {
        heading: m('areas.right-click-menu.items.1.heading'),
        checks: m('areas.right-click-menu.items.1.checks'),
        steps: [
          m('areas.right-click-menu.items.1.steps.0'),
          m('areas.right-click-menu.items.1.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/context-menu-new-group.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.right-click-menu.items.1.examples.0.alt'),
          caption: m('areas.right-click-menu.items.1.examples.0.caption'),
        },
        good: [
          m('areas.right-click-menu.items.1.good.0'),
        ],
      },
    ],
  },
  {
    id: 'upgrading-to-pro',
    title: m('areas.upgrading-to-pro.title'),
    intro:
      m('areas.upgrading-to-pro.intro'),
    items: [
      {
        heading: m('areas.upgrading-to-pro.items.0.heading'),
        checks: m('areas.upgrading-to-pro.items.0.checks'),
        steps: [m('areas.upgrading-to-pro.items.0.steps.0')],
        example: {
          kind: 'testCards',
        },
        good: [
          m('areas.upgrading-to-pro.items.0.good.0'),
        ],
      },
      {
        heading: m('areas.upgrading-to-pro.items.1.heading'),
        checks: m('areas.upgrading-to-pro.items.1.checks'),
        steps: [
          m('areas.upgrading-to-pro.items.1.steps.0'),
          m('areas.upgrading-to-pro.items.1.steps.1'),
          m('areas.upgrading-to-pro.items.1.steps.2'),
          m('areas.upgrading-to-pro.items.1.steps.3'),
        ],
        good: [
          m('areas.upgrading-to-pro.items.1.good.0'),
          m('areas.upgrading-to-pro.items.1.good.1'),
        ],
        report: m('areas.upgrading-to-pro.items.1.report', { FREE_TIER_LIMITS_groups: FREE_TIER_LIMITS.groups, FREE_TIER_LIMITS_tabs: FREE_TIER_LIMITS.tabs, FREE_TIER_LIMITS_urlRules: FREE_TIER_LIMITS.urlRules }),
      },
      {
        heading: m('areas.upgrading-to-pro.items.2.heading'),
        checks: m('areas.upgrading-to-pro.items.2.checks'),
        steps: [
          m('areas.upgrading-to-pro.items.2.steps.0'),
          m('areas.upgrading-to-pro.items.2.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/account-upgrade.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.upgrading-to-pro.items.2.examples.0.alt'),
          caption: m('areas.upgrading-to-pro.items.2.examples.0.caption'),
        },
        good: [
          m('areas.upgrading-to-pro.items.2.good.0'),
          m('areas.upgrading-to-pro.items.2.good.1'),
        ],
        report: m('areas.upgrading-to-pro.items.2.report'),
      },
      {
        heading: m('areas.upgrading-to-pro.items.3.heading'),
        checks: m('areas.upgrading-to-pro.items.3.checks'),
        steps: [
          m('areas.upgrading-to-pro.items.3.steps.0'),
          m('areas.upgrading-to-pro.items.3.steps.1'),
          m('areas.upgrading-to-pro.items.3.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/checkout-local-currency.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.upgrading-to-pro.items.3.examples.0.alt'),
          caption: m('areas.upgrading-to-pro.items.3.examples.0.caption'),
        },
        good: [
          m('areas.upgrading-to-pro.items.3.good.0'),
          m('areas.upgrading-to-pro.items.3.good.1'),
        ],
        report: m('areas.upgrading-to-pro.items.3.report'),
      },
      {
        heading: m('areas.upgrading-to-pro.items.4.heading'),
        checks: m('areas.upgrading-to-pro.items.4.checks'),
        pro: true,
        steps: [
          m('areas.upgrading-to-pro.items.4.steps.0'),
          m('areas.upgrading-to-pro.items.4.steps.1'),
          m('areas.upgrading-to-pro.items.4.steps.2'),
          m('areas.upgrading-to-pro.items.4.steps.3'),
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/pricing-switch.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.upgrading-to-pro.items.4.examples.0.alt'),
            caption: m('areas.upgrading-to-pro.items.4.examples.0.caption'),
          },
          {
            kind: 'image',
            src: '/beta/portal-switch.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.upgrading-to-pro.items.4.examples.1.alt', BETA_PRICE_VALUES),
            caption: m('areas.upgrading-to-pro.items.4.examples.1.caption'),
          },
        ],
        good: [
          m('areas.upgrading-to-pro.items.4.good.0'),
          m('areas.upgrading-to-pro.items.4.good.1', BETA_PRICE_VALUES),
          m('areas.upgrading-to-pro.items.4.good.2'),
          m('areas.upgrading-to-pro.items.4.good.3'),
          m('areas.upgrading-to-pro.items.4.good.4'),
        ],
        report: m('areas.upgrading-to-pro.items.4.report'),
      },
      {
        heading: m('areas.upgrading-to-pro.items.5.heading'),
        checks: m('areas.upgrading-to-pro.items.5.checks'),
        pro: true,
        steps: [
          m('areas.upgrading-to-pro.items.5.steps.0'),
          m('areas.upgrading-to-pro.items.5.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/portal-cancel.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.upgrading-to-pro.items.5.examples.0.alt', BETA_PRICE_VALUES),
          caption: m('areas.upgrading-to-pro.items.5.examples.0.caption'),
        },
        good: [
          m('areas.upgrading-to-pro.items.5.good.0'),
          m('areas.upgrading-to-pro.items.5.good.1'),
        ],
        report: m('areas.upgrading-to-pro.items.5.report'),
      },
    ],
  },
  {
    id: 'drag-and-drop',
    title: m('areas.drag-and-drop.title'),
    intro:
      m('areas.drag-and-drop.intro'),
    items: [
      // --- Sorting ---
      {
        heading: m('areas.drag-and-drop.items.0.heading'),
        checks: m('areas.drag-and-drop.items.0.checks'),
        steps: [
          m('areas.drag-and-drop.items.0.steps.0'),
          m('areas.drag-and-drop.items.0.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-sort-tabs.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.0.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.0.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.0.good.0'),
          m('areas.drag-and-drop.items.0.good.1'),
        ],
      },
      {
        heading: m('areas.drag-and-drop.items.1.heading'),
        checks: m('areas.drag-and-drop.items.1.checks'),
        steps: [m('areas.drag-and-drop.items.1.steps.0')],
        example: {
          kind: 'image',
          src: '/beta/drag-sort-windows.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.1.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.1.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.1.good.0'),
        ],
      },
      {
        heading: m('areas.drag-and-drop.items.2.heading'),
        checks: m('areas.drag-and-drop.items.2.checks'),
        steps: [
          m('areas.drag-and-drop.items.2.steps.0'),
          m('areas.drag-and-drop.items.2.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-reorder-group.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.2.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.2.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.2.good.0'),
          m('areas.drag-and-drop.items.2.good.1'),
        ],
        report: m('areas.drag-and-drop.items.2.report'),
      },

      // --- Cross-window ---
      {
        heading: m('areas.drag-and-drop.items.3.heading'),
        checks: m('areas.drag-and-drop.items.3.checks'),
        steps: [
          m('areas.drag-and-drop.items.3.steps.0'),
          m('areas.drag-and-drop.items.3.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/cross-window-tab-drag.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.3.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.3.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.3.good.0'),
          m('areas.drag-and-drop.items.3.good.1'),
        ],
      },

      // --- Cross-group ---
      {
        heading: m('areas.drag-and-drop.items.4.heading'),
        checks: m('areas.drag-and-drop.items.4.checks'),
        steps: [
          m('areas.drag-and-drop.items.4.steps.0'),
          m('areas.drag-and-drop.items.4.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-single-tab-to-group.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.4.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.4.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.4.good.0'),
          m('areas.drag-and-drop.items.4.good.1'),
        ],
        report: m('areas.drag-and-drop.items.4.report'),
      },
      {
        heading: m('areas.drag-and-drop.items.5.heading'),
        checks: m('areas.drag-and-drop.items.5.checks'),
        steps: [m('areas.drag-and-drop.items.5.steps.0')],
        example: {
          kind: 'image',
          src: '/beta/drag-window-to-group.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.5.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.5.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.5.good.0'),
          m('areas.drag-and-drop.items.5.good.1'),
        ],
        report: m('areas.drag-and-drop.items.5.report'),
      },

      // --- Multi-item ---
      {
        heading: m('areas.drag-and-drop.items.6.heading'),
        checks: m('areas.drag-and-drop.items.6.checks'),
        steps: [
          m('areas.drag-and-drop.items.6.steps.0'),
          m('areas.drag-and-drop.items.6.steps.1'),
          m('areas.drag-and-drop.items.6.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/multi-select-tabs.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.6.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.6.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.6.good.0'),
        ],
      },
      {
        heading: m('areas.drag-and-drop.items.7.heading'),
        checks: m('areas.drag-and-drop.items.7.checks'),
        steps: [
          m('areas.drag-and-drop.items.7.steps.0'),
          m('areas.drag-and-drop.items.7.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-multiselect.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.7.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.7.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.7.good.0'),
        ],
      },
      {
        heading: m('areas.drag-and-drop.items.8.heading'),
        checks: m('areas.drag-and-drop.items.8.checks'),
        steps: [
          m('areas.drag-and-drop.items.8.steps.0'),
          m('areas.drag-and-drop.items.8.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/multi-group-drag.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.8.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.8.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.8.good.0'),
          m('areas.drag-and-drop.items.8.good.1'),
          m('areas.drag-and-drop.items.8.good.2'),
        ],
        // TODO(screenshot): a multi-group sidebar selection mid-drag, once the demo agent has one.
      },

      // --- Drop zones ---
      {
        heading: m('areas.drag-and-drop.items.9.heading'),
        checks: m('areas.drag-and-drop.items.9.checks'),
        steps: [
          m('areas.drag-and-drop.items.9.steps.0'),
          m('areas.drag-and-drop.items.9.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-drop-zones.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.9.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.9.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.9.good.0'),
        ],
        report: m('areas.drag-and-drop.items.9.report'),
        // TODO(screenshot): both drop-zone affordances mid-hover, once available.
      },

      // --- From Now Open ---
      {
        heading: m('areas.drag-and-drop.items.10.heading'),
        checks: m('areas.drag-and-drop.items.10.checks'),
        steps: [
          m('areas.drag-and-drop.items.10.steps.0'),
          m('areas.drag-and-drop.items.10.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-now-open-tab.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.10.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.10.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.10.good.0'),
          m('areas.drag-and-drop.items.10.good.1'),
        ],
        report: m('areas.drag-and-drop.items.10.report'),
      },

      // --- Cancel and edge cases ---
      {
        heading: m('areas.drag-and-drop.items.11.heading'),
        checks: m('areas.drag-and-drop.items.11.checks'),
        steps: [
          m('areas.drag-and-drop.items.11.steps.0'),
          m('areas.drag-and-drop.items.11.steps.1'),
          m('areas.drag-and-drop.items.11.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/undo-redo-enabled.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.drag-and-drop.items.11.examples.0.alt'),
          caption: m('areas.drag-and-drop.items.11.examples.0.caption'),
        },
        good: [
          m('areas.drag-and-drop.items.11.good.0'),
          m('areas.drag-and-drop.items.11.good.1'),
        ],
        report: m('areas.drag-and-drop.items.11.report'),
      },

      // --- Keyboard drag ---
      {
        heading: m('areas.drag-and-drop.items.12.heading'),
        checks: m('areas.drag-and-drop.items.12.checks'),
        steps: [
          m('areas.drag-and-drop.items.12.steps.0'),
          m('areas.drag-and-drop.items.12.steps.1'),
          m('areas.drag-and-drop.items.12.steps.2'),
          m('areas.drag-and-drop.items.12.steps.3'),
          m('areas.drag-and-drop.items.12.steps.4'),
          m('areas.drag-and-drop.items.12.steps.5'),
          m('areas.drag-and-drop.items.12.steps.6'),
        ],
        good: [
          m('areas.drag-and-drop.items.12.good.0'),
          m('areas.drag-and-drop.items.12.good.1'),
          m('areas.drag-and-drop.items.12.good.2'),
          m('areas.drag-and-drop.items.12.good.3'),
          m('areas.drag-and-drop.items.12.good.4'),
          m('areas.drag-and-drop.items.12.good.5'),
          m('areas.drag-and-drop.items.12.good.6'),
          m('areas.drag-and-drop.items.12.good.7'),
          m('areas.drag-and-drop.items.12.good.8'),
          m('areas.drag-and-drop.items.12.good.9'),
          m('areas.drag-and-drop.items.12.good.10'),
          m('areas.drag-and-drop.items.12.good.11'),
          m('areas.drag-and-drop.items.12.good.12'),
          m('areas.drag-and-drop.items.12.good.13'),
        ],
      },

      // --- Persistence ---
      {
        heading: m('areas.drag-and-drop.items.13.heading'),
        checks: m('areas.drag-and-drop.items.13.checks'),
        pro: m('areas.drag-and-drop.items.13.pro'),
        steps: [
          m('areas.drag-and-drop.items.13.steps.0'),
          m('areas.drag-and-drop.items.13.steps.1'),
        ],
        good: [
          m('areas.drag-and-drop.items.13.good.0'),
          m('areas.drag-and-drop.items.13.good.1'),
        ],
      },
    ],
  },
  {
    id: 'web-app-and-dashboard',
    title: m('areas.web-app-and-dashboard.title'),
    intro:
      m('areas.web-app-and-dashboard.intro'),
    items: [
      {
        heading: m('areas.web-app-and-dashboard.items.0.heading'),
        checks: m('areas.web-app-and-dashboard.items.0.checks'),
        steps: [
          m('areas.web-app-and-dashboard.items.0.steps.0'),
          m('areas.web-app-and-dashboard.items.0.steps.1'),
          m('areas.web-app-and-dashboard.items.0.steps.2'),
          m('areas.web-app-and-dashboard.items.0.steps.3'),
        ],
        example: {
          kind: 'image',
          src: '/beta/web-sign-in.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.web-app-and-dashboard.items.0.examples.0.alt'),
          caption: m('areas.web-app-and-dashboard.items.0.examples.0.caption'),
        },
        good: [
          m('areas.web-app-and-dashboard.items.0.good.0'),
          m('areas.web-app-and-dashboard.items.0.good.1'),
          m('areas.web-app-and-dashboard.items.0.good.2'),
        ],
      },
      {
        heading: m('areas.web-app-and-dashboard.items.1.heading'),
        checks: m('areas.web-app-and-dashboard.items.1.checks'),
        steps: [
          m('areas.web-app-and-dashboard.items.1.steps.0'),
        ],
        example: {
          kind: 'image',
          src: '/beta/sign-up.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.web-app-and-dashboard.items.1.examples.0.alt'),
          caption: m('areas.web-app-and-dashboard.items.1.examples.0.caption'),
        },
        good: [
          m('areas.web-app-and-dashboard.items.1.good.0'),
        ],
        report: m('areas.web-app-and-dashboard.items.1.report'),
      },
      {
        heading: m('areas.web-app-and-dashboard.items.2.heading'),
        checks: m('areas.web-app-and-dashboard.items.2.checks'),
        steps: [
          m('areas.web-app-and-dashboard.items.2.steps.0'),
          m('areas.web-app-and-dashboard.items.2.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/forgot-password.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.web-app-and-dashboard.items.2.examples.0.alt'),
          caption: m('areas.web-app-and-dashboard.items.2.examples.0.caption'),
        },
        good: [
          m('areas.web-app-and-dashboard.items.2.good.0'),
          m('areas.web-app-and-dashboard.items.2.good.1'),
        ],
      },
      {
        heading: m('areas.web-app-and-dashboard.items.3.heading'),
        checks: m('areas.web-app-and-dashboard.items.3.checks'),
        pro: true,
        steps: [
          m('areas.web-app-and-dashboard.items.3.steps.0'),
          m('areas.web-app-and-dashboard.items.3.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/dashboard-groups.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.web-app-and-dashboard.items.3.examples.0.alt'),
          caption: m('areas.web-app-and-dashboard.items.3.examples.0.caption'),
        },
        good: [
          m('areas.web-app-and-dashboard.items.3.good.0'),
        ],
      },
      {
        heading: m('areas.web-app-and-dashboard.items.4.heading'),
        checks: m('areas.web-app-and-dashboard.items.4.checks'),
        pro: true,
        steps: [
          m('areas.web-app-and-dashboard.items.4.steps.0'),
        ],
        good: [
          m('areas.web-app-and-dashboard.items.4.good.0'),
          m('areas.web-app-and-dashboard.items.4.good.1'),
        ],
        report: m('areas.web-app-and-dashboard.items.4.report'),
      },
      {
        heading: m('areas.web-app-and-dashboard.items.5.heading'),
        checks: m('areas.web-app-and-dashboard.items.5.checks'),
        pro: true,
        steps: [
          m('areas.web-app-and-dashboard.items.5.steps.0'),
          m('areas.web-app-and-dashboard.items.5.steps.1'),
        ],
        good: [
          m('areas.web-app-and-dashboard.items.5.good.0'),
          m('areas.web-app-and-dashboard.items.5.good.1'),
        ],
      },
      {
        heading: m('areas.web-app-and-dashboard.items.6.heading'),
        checks: m('areas.web-app-and-dashboard.items.6.checks'),
        pro: true,
        steps: [
          m('areas.web-app-and-dashboard.items.6.steps.0'),
        ],
        good: [
          m('areas.web-app-and-dashboard.items.6.good.0'),
        ],
      },
      {
        heading: m('areas.web-app-and-dashboard.items.7.heading'),
        checks: m('areas.web-app-and-dashboard.items.7.checks'),
        pro: m('areas.web-app-and-dashboard.items.7.pro'),
        steps: [
          m('areas.web-app-and-dashboard.items.7.steps.0'),
          m('areas.web-app-and-dashboard.items.7.steps.1'),
          m('areas.web-app-and-dashboard.items.7.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/account-page.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.web-app-and-dashboard.items.7.examples.0.alt', BETA_PRICE_VALUES),
          caption: m('areas.web-app-and-dashboard.items.7.examples.0.caption'),
        },
        good: [
          m('areas.web-app-and-dashboard.items.7.good.0'),
          m('areas.web-app-and-dashboard.items.7.good.1'),
          m('areas.web-app-and-dashboard.items.7.good.2'),
          m('areas.web-app-and-dashboard.items.7.good.3'),
        ],
      },
      {
        heading: m('areas.web-app-and-dashboard.items.8.heading'),
        checks: m('areas.web-app-and-dashboard.items.8.checks'),
        steps: [
          m('areas.web-app-and-dashboard.items.8.steps.0'),
          m('areas.web-app-and-dashboard.items.8.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/phone-dashboard.webp',
          width: 780,
          height: 1200,
          alt: m('areas.web-app-and-dashboard.items.8.examples.0.alt'),
          caption: m('areas.web-app-and-dashboard.items.8.examples.0.caption'),
        },
        good: [
          m('areas.web-app-and-dashboard.items.8.good.0'),
          m('areas.web-app-and-dashboard.items.8.good.1'),
        ],
        report: m('areas.web-app-and-dashboard.items.8.report'),
      },
      {
        heading: m('areas.web-app-and-dashboard.items.9.heading'),
        checks: m('areas.web-app-and-dashboard.items.9.checks'),
        steps: [
          m('areas.web-app-and-dashboard.items.9.steps.0'),
          m('areas.web-app-and-dashboard.items.9.steps.1'),
          m('areas.web-app-and-dashboard.items.9.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/toast.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.web-app-and-dashboard.items.9.examples.0.alt'),
          caption: m('areas.web-app-and-dashboard.items.9.examples.0.caption'),
        },
        good: [
          m('areas.web-app-and-dashboard.items.9.good.0'),
          m('areas.web-app-and-dashboard.items.9.good.1'),
          m('areas.web-app-and-dashboard.items.9.good.2'),
        ],
        report: m('areas.web-app-and-dashboard.items.9.report'),
      },
    ],
  },
  {
    id: 'sharing',
    title: m('areas.sharing.title'),
    intro:
      m('areas.sharing.intro'),
    items: [
      {
        heading: m('areas.sharing.items.0.heading'),
        checks: m('areas.sharing.items.0.checks'),
        pro: true,
        steps: [
          m('areas.sharing.items.0.steps.0'),
          m('areas.sharing.items.0.steps.1'),
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/share-extension.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sharing.items.0.examples.0.alt'),
            caption: m('areas.sharing.items.0.examples.0.caption'),
          },
          {
            kind: 'image',
            src: '/beta/share-extension-toast.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sharing.items.0.examples.1.alt'),
            caption: m('areas.sharing.items.0.examples.1.caption'),
          },
        ],
        good: [
          m('areas.sharing.items.0.good.0'),
          m('areas.sharing.items.0.good.1'),
        ],
      },
      {
        heading: m('areas.sharing.items.1.heading'),
        checks: m('areas.sharing.items.1.checks'),
        pro: m('areas.sharing.items.1.pro'),
        steps: [
          m('areas.sharing.items.1.steps.0'),
          m('areas.sharing.items.1.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/share-page.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.sharing.items.1.examples.0.alt'),
          caption: m('areas.sharing.items.1.examples.0.caption'),
        },
        good: [
          m('areas.sharing.items.1.good.0'),
          m('areas.sharing.items.1.good.1'),
          m('areas.sharing.items.1.good.2'),
        ],
      },
      {
        heading: m('areas.sharing.items.2.heading'),
        checks: m('areas.sharing.items.2.checks'),
        pro: m('areas.sharing.items.2.pro'),
        steps: [
          m('areas.sharing.items.2.steps.0'),
          m('areas.sharing.items.2.steps.1'),
          m('areas.sharing.items.2.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/share-page-previews.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.sharing.items.2.examples.0.alt'),
          caption: m('areas.sharing.items.2.examples.0.caption'),
        },
        good: [
          m('areas.sharing.items.2.good.0'),
          m('areas.sharing.items.2.good.1'),
          m('areas.sharing.items.2.good.2'),
        ],
      },
      {
        heading: m('areas.sharing.items.3.heading'),
        checks: m('areas.sharing.items.3.checks'),
        pro: true,
        steps: [m('areas.sharing.items.3.steps.0')],
        example: {
          kind: 'image',
          src: '/beta/share-page-windows.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.sharing.items.3.examples.0.alt'),
          caption: m('areas.sharing.items.3.examples.0.caption'),
        },
        good: [
          m('areas.sharing.items.3.good.0'),
        ],
      },
      {
        heading: m('areas.sharing.items.4.heading'),
        checks: m('areas.sharing.items.4.checks'),
        pro: true,
        steps: [
          m('areas.sharing.items.4.steps.0'),
        ],
        example: {
          kind: 'image',
          src: '/beta/share-dashboard.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.sharing.items.4.examples.0.alt'),
          caption: m('areas.sharing.items.4.examples.0.caption'),
        },
        good: [
          m('areas.sharing.items.4.good.0'),
        ],
      },
      {
        heading: m('areas.sharing.items.5.heading'),
        checks: m('areas.sharing.items.5.checks'),
        pro: true,
        steps: [
          m('areas.sharing.items.5.steps.0'),
        ],
        good: [
          m('areas.sharing.items.5.good.0'),
          m('areas.sharing.items.5.good.1'),
        ],
      },
    ],
  },
  {
    id: 'settings',
    title: m('areas.settings.title'),
    intro:
      m('areas.settings.intro'),
    items: [
      {
        heading: m('areas.settings.items.0.heading'),
        checks: m('areas.settings.items.0.checks'),
        steps: [
          m('areas.settings.items.0.steps.0'),
          m('areas.settings.items.0.steps.1'),
          m('areas.settings.items.0.steps.2'),
          m('areas.settings.items.0.steps.3'),
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-general.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.settings.items.0.examples.0.alt'),
          caption: m('areas.settings.items.0.examples.0.caption'),
        },
        good: [
          m('areas.settings.items.0.good.0'),
          m('areas.settings.items.0.good.1'),
          m('areas.settings.items.0.good.2'),
          m('areas.settings.items.0.good.3'),
        ],
      },
      {
        heading: m('areas.settings.items.1.heading'),
        checks: m('areas.settings.items.1.checks'),
        steps: [
          m('areas.settings.items.1.steps.0'),
          m('areas.settings.items.1.steps.1'),
          m('areas.settings.items.1.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/hover-preview-off.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.settings.items.1.examples.0.alt'),
          caption: m('areas.settings.items.1.examples.0.caption'),
        },
        good: [
          m('areas.settings.items.1.good.0'),
          m('areas.settings.items.1.good.1'),
          m('areas.settings.items.1.good.2'),
        ],
        report: m('areas.settings.items.1.report'),
      },
      {
        heading: m('areas.settings.items.2.heading'),
        checks: m('areas.settings.items.2.checks'),
        pro: m('areas.settings.items.2.pro'),
        steps: [
          m('areas.settings.items.2.steps.0'),
          m('areas.settings.items.2.steps.1'),
          m('areas.settings.items.2.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-urlrules.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.settings.items.2.examples.0.alt'),
          caption: m('areas.settings.items.2.examples.0.caption'),
        },
        good: [
          m('areas.settings.items.2.good.0'),
          m('areas.settings.items.2.good.1'),
          m('areas.settings.items.2.good.2'),
          m('areas.settings.items.2.good.3'),
        ],
      },
      {
        heading: m('areas.settings.items.3.heading'),
        checks: m('areas.settings.items.3.checks'),
        steps: [
          m('areas.settings.items.3.steps.0'),
          m('areas.settings.items.3.steps.1'),
          m('areas.settings.items.3.steps.2'),
          m('areas.settings.items.3.steps.3'),
          m('areas.settings.items.3.steps.4'),
        ],
        good: [
          m('areas.settings.items.3.good.0'),
          m('areas.settings.items.3.good.1'),
          m('areas.settings.items.3.good.2'),
          m('areas.settings.items.3.good.3'),
        ],
        report: m('areas.settings.items.3.report'),
      },
      {
        heading: m('areas.settings.items.4.heading'),
        checks: m('areas.settings.items.4.checks'),
        steps: [
          m('areas.settings.items.4.steps.0'),
          m('areas.settings.items.4.steps.1'),
          m('areas.settings.items.4.steps.2'),
          m('areas.settings.items.4.steps.3'),
          m('areas.settings.items.4.steps.4'),
          m('areas.settings.items.4.steps.5'),
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-urlrules-manager.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.settings.items.4.examples.0.alt'),
          caption: m('areas.settings.items.4.examples.0.caption'),
        },
        good: [
          m('areas.settings.items.4.good.0'),
          m('areas.settings.items.4.good.1'),
          m('areas.settings.items.4.good.2'),
          m('areas.settings.items.4.good.3'),
        ],
        report: m('areas.settings.items.4.report'),
      },
      {
        heading: m('areas.settings.items.5.heading'),
        checks: m('areas.settings.items.5.checks'),
        steps: [
          m('areas.settings.items.5.steps.0'),
          m('areas.settings.items.5.steps.1'),
          m('areas.settings.items.5.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-account.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.settings.items.5.examples.0.alt', BETA_PRICE_VALUES),
          caption: m('areas.settings.items.5.examples.0.caption'),
        },
        good: [
          m('areas.settings.items.5.good.0', BETA_PRICE_VALUES),
          m('areas.settings.items.5.good.1'),
          m('areas.settings.items.5.good.2'),
          m('areas.settings.items.5.good.3'),
          m('areas.settings.items.5.good.4'),
        ],
      },
      {
        heading: m('areas.settings.items.6.heading'),
        checks: m('areas.settings.items.6.checks'),
        pro: true,
        steps: [
          m('areas.settings.items.6.steps.0'),
        ],
        good: [
          m('areas.settings.items.6.good.0'),
        ],
      },
      {
        heading: m('areas.settings.items.7.heading'),
        checks: m('areas.settings.items.7.checks'),
        steps: [
          m('areas.settings.items.7.steps.0'),
          m('areas.settings.items.7.steps.1'),
          m('areas.settings.items.7.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-import-export.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.settings.items.7.examples.0.alt'),
          caption: m('areas.settings.items.7.examples.0.caption'),
        },
        good: [
          m('areas.settings.items.7.good.0'),
          m('areas.settings.items.7.good.1'),
          m('areas.settings.items.7.good.2'),
          m('areas.settings.items.7.good.3'),
          m('areas.settings.items.7.good.4'),
        ],
        report: m('areas.settings.items.7.report'),
      },
      {
        heading: m('areas.settings.items.8.heading'),
        checks: m('areas.settings.items.8.checks'),
        steps: [
          m('areas.settings.items.8.steps.0'),
          m('areas.settings.items.8.steps.1'),
          m('areas.settings.items.8.steps.2'),
          m('areas.settings.items.8.steps.3'),
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-unsaved.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.settings.items.8.examples.0.alt'),
          caption: m('areas.settings.items.8.examples.0.caption'),
        },
        good: [
          m('areas.settings.items.8.good.0'),
          m('areas.settings.items.8.good.1'),
          m('areas.settings.items.8.good.2'),
          m('areas.settings.items.8.good.3'),
        ],
        report: m('areas.settings.items.8.report'),
      },
      {
        heading: m('areas.settings.items.9.heading'),
        checks: m('areas.settings.items.9.checks'),
        steps: [m('areas.settings.items.9.steps.0')],
        good: [
          m('areas.settings.items.9.good.0'),
        ],
      },
    ],
  },
  {
    id: 'sign-in-and-sync',
    title: m('areas.sign-in-and-sync.title'),
    intro:
      m('areas.sign-in-and-sync.intro'),
    items: [
      {
        heading: m('areas.sign-in-and-sync.items.0.heading'),
        checks: m('areas.sign-in-and-sync.items.0.checks'),
        pro: true,
        steps: [
          m('areas.sign-in-and-sync.items.0.steps.0'),
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/sign-in.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sign-in-and-sync.items.0.examples.0.alt'),
            caption: m('areas.sign-in-and-sync.items.0.examples.0.caption'),
          },
          {
            kind: 'image',
            src: '/beta/sync-device-a.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sign-in-and-sync.items.0.examples.1.alt'),
            caption: m('areas.sign-in-and-sync.items.0.examples.1.caption'),
          },
          {
            kind: 'image',
            src: '/beta/sync-device-b.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sign-in-and-sync.items.0.examples.2.alt'),
            caption: m('areas.sign-in-and-sync.items.0.examples.2.caption'),
          },
        ],
        good: [
          m('areas.sign-in-and-sync.items.0.good.0'),
        ],
      },
      {
        heading: m('areas.sign-in-and-sync.items.1.heading'),
        checks: m('areas.sign-in-and-sync.items.1.checks'),
        pro: true,
        steps: [m('areas.sign-in-and-sync.items.1.steps.0'), m('areas.sign-in-and-sync.items.1.steps.1')],
        example: [
          {
            kind: 'image',
            src: '/beta/sync-rename-a.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sign-in-and-sync.items.1.examples.0.alt'),
            caption: m('areas.sign-in-and-sync.items.1.examples.0.caption'),
          },
          {
            kind: 'image',
            src: '/beta/sync-rename-b.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sign-in-and-sync.items.1.examples.1.alt'),
            caption: m('areas.sign-in-and-sync.items.1.examples.1.caption'),
          },
        ],
        good: [
          m('areas.sign-in-and-sync.items.1.good.0'),
        ],
      },
      {
        heading: m('areas.sign-in-and-sync.items.2.heading'),
        checks: m('areas.sign-in-and-sync.items.2.checks'),
        pro: true,
        steps: [m('areas.sign-in-and-sync.items.2.steps.0'), m('areas.sign-in-and-sync.items.2.steps.1')],
        example: [
          {
            kind: 'image',
            src: '/beta/sync-delete-a.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sign-in-and-sync.items.2.examples.0.alt'),
            caption: m('areas.sign-in-and-sync.items.2.examples.0.caption'),
          },
          {
            kind: 'image',
            src: '/beta/sync-delete-b.webp',
            width: 1600,
            height: 1200,
            alt: m('areas.sign-in-and-sync.items.2.examples.1.alt'),
            caption: m('areas.sign-in-and-sync.items.2.examples.1.caption'),
          },
        ],
        good: [
          m('areas.sign-in-and-sync.items.2.good.0'),
        ],
        report: m('areas.sign-in-and-sync.items.2.report'),
      },
      {
        heading: m('areas.sign-in-and-sync.items.3.heading'),
        checks: m('areas.sign-in-and-sync.items.3.checks'),
        pro: true,
        steps: [
          m('areas.sign-in-and-sync.items.3.steps.0'),
          m('areas.sign-in-and-sync.items.3.steps.1'),
        ],
        good: [
          m('areas.sign-in-and-sync.items.3.good.0'),
          m('areas.sign-in-and-sync.items.3.good.1'),
        ],
        report: m('areas.sign-in-and-sync.items.3.report'),
      },
      {
        heading: m('areas.sign-in-and-sync.items.4.heading'),
        checks: m('areas.sign-in-and-sync.items.4.checks'),
        pro: true,
        steps: [m('areas.sign-in-and-sync.items.4.steps.0'), m('areas.sign-in-and-sync.items.4.steps.1'), m('areas.sign-in-and-sync.items.4.steps.2')],
        good: [
          m('areas.sign-in-and-sync.items.4.good.0'),
        ],
      },
      {
        heading: m('areas.sign-in-and-sync.items.5.heading'),
        checks: m('areas.sign-in-and-sync.items.5.checks'),
        pro: true,
        steps: [
          m('areas.sign-in-and-sync.items.5.steps.0'),
          m('areas.sign-in-and-sync.items.5.steps.1'),
          m('areas.sign-in-and-sync.items.5.steps.2'),
        ],
        good: [
          m('areas.sign-in-and-sync.items.5.good.0'),
          m('areas.sign-in-and-sync.items.5.good.1'),
        ],
        report: m('areas.sign-in-and-sync.items.5.report'),
      },
      {
        heading: m('areas.sign-in-and-sync.items.6.heading'),
        checks: m('areas.sign-in-and-sync.items.6.checks'),
        pro: true,
        steps: [
          m('areas.sign-in-and-sync.items.6.steps.0'),
          m('areas.sign-in-and-sync.items.6.steps.1'),
          m('areas.sign-in-and-sync.items.6.steps.2'),
          m('areas.sign-in-and-sync.items.6.steps.3'),
        ],
        good: [
          m('areas.sign-in-and-sync.items.6.good.0'),
          m('areas.sign-in-and-sync.items.6.good.1', { CONFLICT_COPY_SUFFIX: CONFLICT_COPY_SUFFIX }),
          m('areas.sign-in-and-sync.items.6.good.2'),
          m('areas.sign-in-and-sync.items.6.good.3'),
        ],
        report: m('areas.sign-in-and-sync.items.6.report'),
      },
    ],
  },
  {
    id: 'encryption',
    title: m('areas.encryption.title'),
    intro:
      m('areas.encryption.intro'),
    items: [
      {
        heading: m('areas.encryption.items.0.heading'),
        checks: m('areas.encryption.items.0.checks'),
        pro: true,
        steps: [
          m('areas.encryption.items.0.steps.0'),
          m('areas.encryption.items.0.steps.1'),
          m('areas.encryption.items.0.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/encryption-setup.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.encryption.items.0.examples.0.alt'),
          caption: m('areas.encryption.items.0.examples.0.caption'),
        },
        good: [
          m('areas.encryption.items.0.good.0'),
          m('areas.encryption.items.0.good.1'),
          m('areas.encryption.items.0.good.2'),
          m('areas.encryption.items.0.good.3'),
        ],
      },
      {
        heading: m('areas.encryption.items.1.heading'),
        checks: m('areas.encryption.items.1.checks'),
        pro: true,
        steps: [
          m('areas.encryption.items.1.steps.0'),
          m('areas.encryption.items.1.steps.1'),
          m('areas.encryption.items.1.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/encryption-unlock.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.encryption.items.1.examples.0.alt'),
          caption: m('areas.encryption.items.1.examples.0.caption'),
        },
        good: [
          m('areas.encryption.items.1.good.0'),
          m('areas.encryption.items.1.good.1'),
          m('areas.encryption.items.1.good.2'),
        ],
      },
      {
        heading: m('areas.encryption.items.2.heading'),
        checks: m('areas.encryption.items.2.checks'),
        pro: true,
        steps: [
          m('areas.encryption.items.2.steps.0'),
          m('areas.encryption.items.2.steps.1'),
        ],
        good: [
          m('areas.encryption.items.2.good.0'),
          m('areas.encryption.items.2.good.1'),
        ],
      },
      {
        heading: m('areas.encryption.items.3.heading'),
        checks: m('areas.encryption.items.3.checks'),
        pro: true,
        steps: [
          m('areas.encryption.items.3.steps.0'),
          m('areas.encryption.items.3.steps.1'),
          m('areas.encryption.items.3.steps.2'),
        ],
        example: {
          kind: 'image',
          src: '/beta/encryption-reset.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.encryption.items.3.examples.0.alt'),
          caption: m('areas.encryption.items.3.examples.0.caption'),
        },
        good: [
          m('areas.encryption.items.3.good.0'),
          m('areas.encryption.items.3.good.1'),
        ],
      },
      {
        heading: m('areas.encryption.items.4.heading'),
        checks: m('areas.encryption.items.4.checks'),
        pro: true,
        steps: [
          m('areas.encryption.items.4.steps.0'),
          m('areas.encryption.items.4.steps.1'),
        ],
        example: {
          kind: 'image',
          src: '/beta/dashboard-passphrase.webp',
          width: 1600,
          height: 1200,
          alt: m('areas.encryption.items.4.examples.0.alt'),
          caption: m('areas.encryption.items.4.examples.0.caption'),
        },
        good: [
          m('areas.encryption.items.4.good.0'),
          m('areas.encryption.items.4.good.1'),
          m('areas.encryption.items.4.good.2'),
          m('areas.encryption.items.4.good.3'),
          m('areas.encryption.items.4.good.4'),
        ],
      },
      {
        heading: m('areas.encryption.items.5.heading'),
        checks: m('areas.encryption.items.5.checks'),
        pro: true,
        steps: [
          m('areas.encryption.items.5.steps.0'),
          m('areas.encryption.items.5.steps.1'),
        ],
        good: [
          m('areas.encryption.items.5.good.0'),
          m('areas.encryption.items.5.good.1'),
        ],
      },
    ],
  },
]

const WANT_TO_HEAR_ABOUT: Msg[] = [
  m('wantToHear.0'),
  m('wantToHear.1', { CONFLICT_COPY_SUFFIX: CONFLICT_COPY_SUFFIX.trim() }),
  m('wantToHear.2'),
  m('wantToHear.3'),
]

/** The test areas with their copy in the request's language. */
function translateAreas(t: BetaT) {
  const tr = (msg: Msg) => translate(t, msg)
  return TEST_AREAS.map((area) => ({
    ...area,
    title: tr(area.title),
    intro: area.intro && tr(area.intro),
    items: area.items.map(
      (item): TestItem => ({
        ...item,
        heading: tr(item.heading),
        checks: tr(item.checks),
        steps: item.steps.map(tr),
        good: item.good.map(tr),
        report: item.report && tr(item.report),
        pro: item.pro === undefined || item.pro === true ? item.pro : tr(item.pro),
        example: toExamples(item.example).map((example): Example =>
          example.kind === 'image'
            ? { ...example, alt: tr(example.alt), caption: example.caption && tr(example.caption) }
            : { ...example, caption: example.caption && tr(example.caption) }
        ),
      })
    ),
  }))
}

export default function BetaPage() {
  if (isProductionDeployment()) notFound()

  const t = useTranslations('beta')
  const tr = (msg: Msg) => translate(t, msg)
  const areas = translateAreas(t)
  const link = (href: string, external = true) =>
    function BetaLink(chunks: React.ReactNode) {
      return (
        <a
          href={href}
          {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          className="underline underline-offset-4 hover:text-foreground transition-colors"
        >
          {chunks}
        </a>
      )
    }
  const strong = (chunks: React.ReactNode) => <strong className="text-foreground">{chunks}</strong>
  const code = (chunks: React.ReactNode) => <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{chunks}</code>

  return (
    <div className="container py-16 max-w-5xl">
      {/* Hero */}
      <div className="mb-11 rounded-none bg-accent border border-primary/20 px-8 py-7">
        <p className="text-sm text-muted-foreground mb-2">{t('eyebrow')}</p>
        <h1 className="text-[34px] font-semibold tracking-tight mb-2.5">{t('title')}</h1>
        <p className="max-w-2xl text-[15.5px] text-text2 leading-relaxed mb-5">
          {t('lead')}
        </p>
        <Button asChild size="lg">
          <a href={BETA_GOOGLE_GROUP_URL} target="_blank" rel="noreferrer">
            {t('join')}
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-12 items-start">
        <LegalToc items={TOC.map((item) => ({ ...item, label: tr(item.label) }))} heading={t('onThisPage')} />

        <div className="space-y-14 max-w-2xl">
          {/* Join & install */}
          <section id="join" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">{t('install.heading')}</h2>
            <ol className="space-y-4 text-muted-foreground leading-relaxed list-decimal list-inside">
              <li>
                <span className="text-foreground font-medium">{t('install.groupTitle')}</span>{' '}
                {t.rich('install.groupBody', { link: link(BETA_GOOGLE_GROUP_URL), strong })}
              </li>
              <li>
                <span className="text-foreground font-medium">{t('install.listingTitle')}</span>{' '}
                {BETA_STORE_LISTING_URL ? (
                  <a
                    href={BETA_STORE_LISTING_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-foreground transition-colors"
                  >
                    {t('install.listingLink')}
                  </a>
                ) : (
                  <span>
                    {t('install.listingPending')}
                  </span>
                )}{' '}
                {t.rich('install.listingNotFound', { strong })}
              </li>
              <li>
                <span className="text-foreground font-medium">{t('install.installTitle')}</span> {t('install.installBody')}
              </li>
              <li>
                <span className="text-foreground font-medium">{t('install.signInTitle')}</span>{' '}
                {t.rich('install.signInBody', { link: link('https://preview.tabmerger.com') })}
              </li>
              <li>
                <span className="text-foreground font-medium">{t('install.browsersTitle')}</span>{' '}
                {t('install.browsersBody')}
              </li>
              {FIREFOX_BETA_CONFIGURED ? (
                <li id={BETA_GUIDE_FIREFOX_ID} className="scroll-mt-24">
                  <span className="text-foreground font-medium">{t('install.firefoxTitle')}</span>{' '}
                  {t.rich('install.firefoxBody', { link: link(FIREFOX_BETA_XPI_URL, false), code, strong })}
                  <FirefoxBetaAutoStart xpiHref={FIREFOX_BETA_XPI_URL} />
                </li>
              ) : (
                <li id={BETA_GUIDE_FIREFOX_ID} className="scroll-mt-24">
                  <span className="text-foreground font-medium">{t('install.firefoxTitle')}</span> {t('install.firefoxSoon')}
                  <FirefoxBetaAutoStart xpiHref={null} />
                </li>
              )}
              <li>
                <span className="text-foreground font-medium">{t('install.versionTitle')}</span>{' '}
                {t.rich('install.versionBody', { code })}
              </li>
            </ol>
          </section>

          {/* What to test */}
          <section id="what-to-test" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">{t('test.heading')}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              {t('test.intro')}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 -mt-3 mb-4">
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t('test.tickNote')}
              </p>
              <BetaChecklistReset />
            </div>
            <div className="mb-6 border px-3 py-2 text-sm text-muted-foreground leading-relaxed">
              <p className="font-medium text-foreground mb-1">{t('test.needPro')}</p>
              <p>
                {t.rich('test.needProBody', {
                  full: () => <ProBadge partial={false} />,
                  partial: () => <ProBadge partial />,
                  link: (chunks) => (
                    <a href="#upgrading-to-pro" className="underline underline-offset-4 hover:text-foreground">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>
            <div className="space-y-3">
              {areas.map((area, a) => (
                <Fragment key={area.id}>
                {(a === 0 || areaAccess(areas[a - 1]) !== areaAccess(area)) && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 first:pt-0">
                    {tr(AREA_ACCESS_LABELS[areaAccess(area)])}
                  </p>
                )}
                <details id={area.id} className="scroll-mt-24 group rounded-none border">
                  <summary className="cursor-pointer list-none px-4 py-3 font-medium text-sm flex items-center justify-between">
                    <span className="flex flex-wrap items-center gap-2">
                      {area.title}
                      {area.items.some((item) => item.pro) && (
                        <ProBadge partial={!area.items.every((item) => item.pro === true)} scope="area" />
                      )}
                    </span>
                    <BetaAreaProgress areaId={area.id} items={area.items} />
                    <span className="text-muted-foreground text-xs group-open:hidden">{t('test.show')}</span>
                    <span className="text-muted-foreground text-xs hidden group-open:inline">{t('test.hide')}</span>
                  </summary>
                  <div className="px-4 pb-4 space-y-5">
                    {area.intro && (
                      <p className="text-muted-foreground text-sm leading-relaxed">{area.intro}</p>
                    )}
                    <ul className="space-y-5">
                      {area.items.map((item, i) => (
                        <li key={i} className="text-sm border-t pt-4 first:border-t-0 first:pt-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                            <h3 className="text-foreground font-semibold text-[0.8125rem] uppercase tracking-wide">
                              {item.heading}
                            </h3>
                            {item.pro && <ProBadge partial={item.pro !== true} />}
                          </div>
                          {typeof item.pro === 'string' && (
                            <p className="text-muted-foreground mb-1">
                              <span className="font-medium text-foreground/80">{t('test.proLine')}</span>
                              {item.pro}
                            </p>
                          )}
                          <p className="text-muted-foreground mb-3">
                            <span className="font-medium text-foreground/80">{t('test.checksLine')}</span>
                            {item.checks}
                          </p>
                          <p className="text-foreground font-medium mb-1.5">{t('test.steps')}</p>
                          <BetaStepList areaId={area.id} steps={item.steps} />
                          {toExamples(item.example).map((example, e) => (
                            <div key={e} className="mb-3 max-w-full">
                              {example.kind === 'image' ? (
                                <div
                                  className={cn(
                                    'max-w-full overflow-hidden rounded-none border',
                                    // Portrait (phone) shots at full column width would be taller
                                    // than most screens.
                                    example.height > example.width && 'w-72',
                                  )}
                                >
                                  <Image
                                    src={example.src}
                                    alt={example.alt}
                                    width={example.width}
                                    height={example.height}
                                    loading="lazy"
                                    quality={90}
                                    // Matches the content column's real max width (max-w-2xl =
                                    // 672px) so HiDPI screens request the 2× screenshot source
                                    // instead of Next's default-quality, softened downscale.
                                    sizes={example.height > example.width ? '288px' : '(min-width: 1024px) 672px, 100vw'}
                                    className="w-full h-auto"
                                  />
                                </div>
                              ) : example.kind === 'testCards' ? (
                                <div className="space-y-3">
                                  <div
                                    role="note"
                                    className="rounded-none border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-foreground"
                                  >
                                    <span className="font-medium">{t('test.testCheckout')}</span>
                                    {t('test.testCheckoutBody')}
                                  </div>
                                  <table className="w-full border text-left text-[13px]">
                                    <tbody>
                                      {STRIPE_TEST_CARDS.map((card) => (
                                        <tr key={card.number} className="border-t first:border-t-0">
                                          <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">
                                            {tr(card.label)}
                                            {card.note && (
                                              <span className="block text-[11px] text-primary">{tr(card.note)}</span>
                                            )}
                                          </th>
                                          <td className="px-3 py-2">
                                            <code className="select-all whitespace-nowrap bg-muted px-1.5 py-0.5 font-mono">
                                              {card.number}
                                            </code>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <p className="text-muted-foreground">
                                    {t.rich('test.testCardsFooter', {
                                      code: (chunks) => <code>{chunks}</code>,
                                      link: (chunks) => (
                                        <a
                                          href="https://docs.stripe.com/testing"
                                          target="_blank"
                                          rel="noreferrer"
                                          className="underline underline-offset-4 hover:text-foreground"
                                        >
                                          {chunks}
                                        </a>
                                      ),
                                    })}
                                  </p>
                                </div>
                              ) : (
                                <pre className="max-w-full overflow-x-auto rounded-none border bg-muted/50 p-3 text-[11px] leading-relaxed whitespace-pre">
                                  {example.content}
                                </pre>
                              )}
                              {example.caption && (
                                <p className="mt-1 text-[11px] text-muted-foreground italic">
                                  {example.caption}
                                </p>
                              )}
                            </div>
                          ))}
                          <BetaGoodCheck areaId={area.id} good={item.good} />
                          {item.report && (
                            <p className="text-muted-foreground mt-2">
                              <span className="font-medium text-foreground/80">{t('test.reportLine')}</span>
                              {item.report}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
                </Fragment>
              ))}
            </div>
          </section>

          {/* What we especially want to hear about */}
          <section aria-labelledby="want-to-hear-heading">
            <h2 id="want-to-hear-heading" className="text-xl font-semibold mb-4">
              {t('wantToHearHeading')}
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground text-sm leading-relaxed">
              {WANT_TO_HEAR_ABOUT.map((item) => (
                <li key={item.key}>{tr(item)}</li>
              ))}
            </ul>
          </section>

          {/* Known issues (lib/knownIssues.ts, kept current) */}
          <section id="known-issues" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">{t('knownIssues.heading')}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              {t('knownIssues.intro')}
            </p>
            <ul className="space-y-4">
              {KNOWN_ISSUES.map((issue) => (
                <li
                  key={issue.id}
                  id={`known-issue-${issue.id}`}
                  className="border-l-2 border-border pl-4 scroll-mt-24"
                >
                  <p className="text-sm font-medium">
                    <span className="mr-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                      {issue.area}
                    </span>
                    {issue.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{issue.details}</p>
                  {issue.workaround && (
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">{t('knownIssues.meanwhile')}</span> {issue.workaround}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Report bugs */}
          <section id="report-bugs" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">{t('report.heading')}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-2">
              {t.rich('report.discussions', { repo: GITHUB_REPO, link: link(GITHUB_DISCUSSIONS_URL) })}
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              {t.rich('report.public', { strong })}
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <Button asChild>
                <a href={BUG_REPORT_DISCUSSION_URL} target="_blank" rel="noreferrer">
                  <GitHubMark className="h-4 w-4" />
                  {t('report.bugButton')}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={IDEA_DISCUSSION_URL} target="_blank" rel="noreferrer">
                  <GitHubMark className="h-4 w-4" />
                  {t('report.ideaButton')}
                </a>
              </Button>
            </div>
            <div className="mb-5">
              <Link
                href="/contact?topic=beta"
                className="text-sm underline underline-offset-4 hover:text-foreground transition-colors text-muted-foreground"
              >
                {t('report.noGithub')}
              </Link>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed mb-2">
              {t('report.template')}
            </p>
            <pre className="rounded-none border bg-muted/50 p-4 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap">
{BUG_REPORT_TEMPLATE}
            </pre>
          </section>

          {/* FAQ */}
          <section id="faq" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">{t('faq.heading')}</h2>
            <div className="space-y-5 text-sm">
              <div>
                <h3 className="font-medium text-foreground mb-1">{t('faq.notFoundQ')}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t('faq.notFoundA')}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">{t('faq.stableQ')}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t('faq.stableA')}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">{t('faq.chargedQ')}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t.rich('faq.chargedA', { link: link('https://docs.stripe.com/testing') })}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">{t('faq.syncQ')}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t('faq.syncA')}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">{t('faq.issuesQ')}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t.rich('faq.issuesA', { link: link(GITHUB_DISCUSSIONS_URL) })}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">{t('faq.leaveQ')}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t.rich('faq.leaveA', { link: link(BETA_GOOGLE_GROUP_URL) })}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
