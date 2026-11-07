import { getTranslations } from 'next-intl/server'
import { pageMetadata } from '@/lib/seo'
import { getVisitorBrowser } from '@/lib/visitorBrowser'
import { FinalCta } from '@/components/marketing/FinalCta'
import { ComparisonTable } from '@/components/compare/ComparisonTable'
import { CompareDifferences, CompareHero, CompareSources, SwitchingFromOneTab } from '@/components/compare/CompareSections'

export async function generateMetadata() {
  const t = await getTranslations('compare')
  // The title already names TabMerger, so it skips the " | TabMerger" template.
  return pageMetadata({ path: '/compare', title: t('metaTitle'), description: t('metaDescription'), absoluteTitle: true })
}

/**
 * `/compare`: TabMerger next to OneTab, Session Buddy, Toby and Workona. The data and its sources
 * live in `lib/comparison.ts`; every competitor fact is from that product's own pages, dated.
 * Server-rendered in full (the phone picker only hides columns), and the install buttons follow
 * the visitor's browser.
 */
export default async function ComparePage() {
  const [t, browser] = await Promise.all([getTranslations('compare.table'), getVisitorBrowser()])

  return (
    <>
      <div className="container">
        <div className="mx-auto max-w-[67.5rem]">
          <CompareHero />
          <CompareDifferences />
          <section aria-labelledby="compare-table">
            <h2 id="compare-table" className="text-3xl font-bold tracking-tight">
              {t('title')}
            </h2>
            <p className="mt-2 text-[1.0625rem] text-text2">{t('lead')}</p>
            <ComparisonTable />
          </section>
          <SwitchingFromOneTab browser={browser} />
          <CompareSources />
        </div>
      </div>
      <div className="mt-16">
        <FinalCta browser={browser} />
      </div>
    </>
  )
}
