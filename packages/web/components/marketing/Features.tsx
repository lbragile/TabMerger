import Link from 'next/link'

const leadFeatures = [
  {
    number: '01',
    title: 'AI files the mess for you',
    description:
      'One click clusters your open tabs by topic and names each group. Accept, rename, or ignore.',
    illustration: (
      <div className="rounded-[10px] border border-border bg-surface p-3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary">
          ✦ 24 tabs → 3 groups
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className="h-[22px] px-2 rounded-md bg-violet-soft text-violet text-[11px] grid place-items-center">LLM evals · 9</span>
          <span className="h-[22px] px-2 rounded-md bg-accent text-accent-foreground text-[11px] grid place-items-center">Hiring · 7</span>
          <span className="h-[22px] px-2 rounded-md bg-primary/10 text-primary text-[11px] grid place-items-center">Docs · 8</span>
        </div>
      </div>
    ),
  },
  {
    number: '02',
    title: 'Close everything, lose nothing',
    description:
      'Save a session by name and restore the exact windows and order tomorrow morning.',
    illustration: (
      <div className="rounded-[10px] border border-border bg-surface p-3">
        <div className="text-[12.5px] font-semibold mb-0.5">Morning Research</div>
        <div className="text-[11.5px] text-text3 mb-2">3 groups · 5 windows · 24 tabs</div>
        <div className="flex gap-1">
          <div className="h-1 rounded-full bg-violet" style={{ flex: 2 }} />
          <div className="h-1 rounded-full bg-secondary" style={{ flex: 1 }} />
          <div className="h-1 rounded-full bg-ok" style={{ flex: 1.4 }} />
        </div>
      </div>
    ),
  },
  {
    number: '03',
    title: 'The same tabs on every machine',
    description:
      'Sync is automatic and per-tab, so a laptop edit never clobbers what you did on the desktop.',
    illustration: (
      <div className="rounded-[10px] border border-border bg-surface p-3 flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-ok shrink-0" />
        <span className="text-[12.5px]">Synced 4 minutes ago · 3 devices</span>
      </div>
    ),
  },
]

export function Features() {
  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border">
      <div className="container max-w-[960px]">
        <h2 className="font-semibold tracking-tight max-w-[460px] mb-8 sm:mb-11 text-[28px] sm:text-[34px] leading-tight">
          Built for the moment you have ninety tabs open.
        </h2>

        <div className="flex flex-col">
          {leadFeatures.map((f) => (
            <div
              key={f.number}
              className="grid grid-cols-1 sm:grid-cols-[64px_1fr_1fr] gap-4 sm:gap-8 py-6 border-t border-border items-start"
            >
              <div className="font-mono text-[13px] font-medium text-primary">{f.number}</div>
              <div>
                <h3 className="font-semibold text-[19px] tracking-tight mb-1.5">{f.title}</h3>
                <p className="text-[14.5px] leading-relaxed text-text2">{f.description}</p>
              </div>
              {f.illustration}
            </div>
          ))}
        </div>

        <div className="pt-8 flex justify-center">
          <Link
            href="/features"
            className="inline-flex items-center gap-1.5 h-10 px-5 rounded-[10px] bg-primary text-primary-foreground text-[13.5px] font-medium hover:bg-primary/90 transition-colors"
          >
            See all features
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
