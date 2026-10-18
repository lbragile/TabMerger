import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { UNINSTALL_SURVEY_PARAMS, parseUninstallSurveyParams, uninstallAnalyticsAllowed } from '@tabmerger/shared'
import { Info, Layers } from 'lucide-react'
import { ShellBackdrop } from '@/components/errors/ErrorPageShell'
import { STORE_ICON } from '@/components/marketing/BrowserIcons'
import { StoreLink } from '@/components/StoreLink'
import { Button } from '@/components/ui/button'
import { UninstallSurveyForm } from '@/components/uninstall/UninstallSurveyForm'
import { UninstallTracker } from '@/components/uninstall/UninstallTracker'
import { getReinstallLinks } from '@/lib/storeLinks'

/**
 * /uninstalled — the page the browser opens after TabMerger is removed (the extension sets it
 * with `runtime.setUninstallURL`). Public, never indexed, and linked from nowhere on the site.
 *
 * The query string carries the extension version, browser, channel and analytics-consent flag.
 * Only values that pass `parseUninstallSurveyParams` are used, both here and in what the form
 * sends; the raw query is never rendered or forwarded. When the install allowed analytics
 * (`uninstallAnalyticsAllowed`), `UninstallTracker` records one `extension_uninstalled` event.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('uninstalled')
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: { index: false, follow: false },
  }
}

const BROWSER_NAMES = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  edge: 'Edge',
} as const

const linkClass = 'underline underline-offset-4 hover:text-foreground transition-colors'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function UninstalledPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams
  const params = parseUninstallSurveyParams({
    version: query[UNINSTALL_SURVEY_PARAMS.version],
    browser: query[UNINSTALL_SURVEY_PARAMS.browser],
    channel: query[UNINSTALL_SURVEY_PARAMS.channel],
    analytics: query[UNINSTALL_SURVEY_PARAMS.analytics],
  })
  const reinstall = getReinstallLinks(params.browser, params.channel)
  const t = await getTranslations('uninstalled')

  return (
    <div className="relative isolate overflow-hidden px-4 py-16 sm:px-6 sm:py-24">
      <ShellBackdrop />
      {uninstallAnalyticsAllowed(params) && (
        <UninstallTracker
          version={params.version}
          browser={params.browser}
          channel={params.channel}
          analytics={params.analytics}
        />
      )}

      <div className="relative mx-auto flex w-full min-w-0 max-w-[36rem] flex-col">
        <div className="flex flex-col items-center text-center">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 place-items-center border border-border bg-card text-primary shadow-sh2"
          >
            <Layers className="h-6 w-6" />
          </span>
          <h1
            className="mt-6 text-[2rem] font-bold leading-tight tracking-tight text-foreground sm:text-[2.75rem]"
            style={{ letterSpacing: '-0.02em' }}
          >
            {t('title')}
          </h1>
          <p className="mt-4 max-w-[40ch] text-base text-text2">
            {t('lead')}
          </p>
        </div>

        <div className="mt-10 min-w-0">
          <UninstallSurveyForm version={params.version} browser={params.browser} channel={params.channel} />
        </div>

        <div className="mt-10 space-y-6 text-sm">
          <section aria-labelledby="reinstall-heading" className="border-t border-border pt-6 text-center">
            <h2 id="reinstall-heading" className="text-base font-semibold">
              {t('changedMind')}
            </h2>
            <p className="mb-4 mt-1 text-text2">{t('addBack')}</p>
            <ul className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              {reinstall.map(({ browser, href }) => {
                const BrowserIcon = STORE_ICON[browser]
                return (
                  <li key={browser} className="flex flex-col">
                    <Button variant="outline" asChild>
                      <StoreLink href={href}>
                        {/* The icon names the browser itself; the text already does. */}
                        <span aria-hidden="true" className="flex shrink-0">
                          <BrowserIcon size={16} />
                        </span>
                        {t('addTo', { browser: BROWSER_NAMES[browser] })}
                      </StoreLink>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </section>

          <section aria-labelledby="good-to-know-heading" className="border border-border bg-surface2 p-5">
            <h2 id="good-to-know-heading" className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Info className="h-4 w-4 text-primary" aria-hidden="true" />
              {t('goodToKnow')}
            </h2>
            <ul className="list-disc space-y-2 pl-5 text-text2">
              <li>
                {t('dataNote')}
              </li>
              <li>
                {t.rich('billingNote', {
                  link: (chunks) => (
                    <Link href="/account" className={linkClass}>
                      {chunks}
                    </Link>
                  ),
                  strong: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong>,
                })}
              </li>
              <li>
                {t.rich('helpNote', {
                  link: (chunks) => (
                    <Link href="/contact" className={linkClass}>
                      {chunks}
                    </Link>
                  ),
                })}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
