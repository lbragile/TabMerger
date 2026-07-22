import Link from 'next/link'

const leadFeatures = [
  {
    kicker: '01 · Pro AI',
    title: 'AI auto-organiser',
    description:
      'Paste a tab dump; AI names and files every tab into logical groups in seconds. No manual drag and drop.',
  },
  {
    kicker: '02 · Pro',
    title: 'Save & restore sessions',
    description:
      'Capture every window and tab into a named session. Restore it exactly — same windows, same order — on any machine.',
  },
  {
    kicker: '03 · Pro',
    title: 'Cross-device sync',
    description:
      'Every group and session syncs to the cloud. Open TabMerger on a new machine and pick up exactly where you left off.',
  },
]

const secondaryFeatures = [
  'URL auto-assign rules',
  'Share groups by link',
  'Import / export',
  'Chrome tab-group import',
]

export function Features() {
  return (
    <section style={{ padding: '48px 32px' }}>
      <div className="container">
        {/* Lead feature cards */}
        <div className="grid grid-cols-3 gap-8 mb-10">
          {leadFeatures.map((f) => (
            <div key={f.title} className="border-t-2 border-foreground pt-3.5 flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {f.kicker}
              </p>
              <h4 className="font-bold" style={{ fontSize: '17px' }}>{f.title}</h4>
              <p className="text-muted-foreground" style={{ fontSize: '14px' }}>
                {f.description}
              </p>
            </div>
          ))}
        </div>

        {/* Secondary features strip */}
        <div className="border-t border-border pt-4 flex items-center gap-7 text-[13px] text-muted-foreground">
          {secondaryFeatures.map((f) => (
            <span key={f}>{f}</span>
          ))}
          <Link
            href="/features"
            className="ml-auto shrink-0"
            style={{ color: 'var(--color-accent)' }}
          >
            See all features →
          </Link>
        </div>
      </div>
    </section>
  )
}
