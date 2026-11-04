import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AI_AVAILABILITY } from '@/lib/aiFlag'

type FeaturesT = ReturnType<typeof useTranslations<'home.features'>>

const leadFeatures: {
  number: string
  key: 'ai' | 'sessions' | 'sync'
  isAi?: boolean
  illustration: (t: FeaturesT) => ReactNode
}[] = [
  {
    number: '01',
    key: 'ai',
    isAi: true,
    illustration: (t) => (
      <div className="h-full rounded-md border border-border bg-surface p-3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
          {t('ai.summary')}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className="h-[22px] px-2 rounded-md bg-violet-soft text-violet text-[11px] font-medium grid place-items-center">{t('ai.groupEvals')}</span>
          <span className="h-[22px] px-2 rounded-md bg-secondary/20 text-[hsl(33_90%_28%)] dark:text-secondary text-[11px] font-medium grid place-items-center">{t('ai.groupHiring')}</span>
          <span className="h-[22px] px-2 rounded-md bg-ok-soft text-ok text-[11px] font-medium grid place-items-center">{t('ai.groupDocs')}</span>
        </div>
      </div>
    ),
  },
  {
    number: '02',
    key: 'sessions',
    illustration: (t) => (
      <div className="h-full rounded-md border border-border bg-surface p-3">
        <div className="text-[12.5px] font-semibold mb-0.5">{t('sessions.sessionName')}</div>
        <div className="text-[11.5px] text-text3 mb-2">{t('sessions.sessionStats')}</div>
        <div className="flex overflow-hidden rounded-md">
          <div className="h-1 bg-violet" style={{ flex: 2 }} />
          <div className="h-1 bg-secondary" style={{ flex: 1 }} />
          <div className="h-1 bg-ok" style={{ flex: 1.4 }} />
        </div>
      </div>
    ),
  },
  {
    number: '03',
    key: 'sync',
    illustration: (t) => (
      <div className="h-full rounded-md border border-border bg-surface p-3 flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-ok shrink-0" />
        <span className="text-[12.5px]">{t('sync.status')}</span>
      </div>
    ),
  },
]

export function Features() {
  const t = useTranslations('home.features')
  const common = useTranslations('common')
  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border">
      <div className="container max-w-[960px]">
        <h2 className="font-semibold tracking-tight max-w-[460px] mb-8 sm:mb-11 text-[28px] sm:text-[34px] leading-tight">
          {t('title')}
        </h2>

        <div className="flex flex-col">
          {leadFeatures.map((f) => (
            <div
              key={f.number}
              className="grid grid-cols-1 sm:grid-cols-[64px_1fr_1fr] gap-4 sm:gap-8 py-6 border-t border-border items-stretch"
            >
              <div className="font-mono text-[13px] font-medium text-primary">{f.number}</div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="font-semibold text-[19px] tracking-tight">{t(`${f.key}.title`)}</h3>
                  {f.isAi && !AI_AVAILABILITY.any && (
                    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
                      {common('comingSoon')}
                    </span>
                  )}
                  {/* Only the own-key option is live yet: say so, so nobody expects AI included. */}
                  {f.isAi && AI_AVAILABILITY.any && !AI_AVAILABILITY.managed && (
                    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary">
                      {common('withYourOwnKey')}
                    </span>
                  )}
                </div>
                <p className="text-[14.5px] leading-relaxed text-text2">{t(`${f.key}.description`)}</p>
              </div>
              {f.illustration(t)}
            </div>
          ))}
        </div>

        <div className="pt-8 flex justify-center">
          <Link
            href="/features"
            className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-primary text-primary-foreground text-[13.5px] font-medium hover:bg-primary/90 transition-colors"
          >
            {t('seeAll')}
            {/* Points forward: mirrored right to left. */}
            <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
