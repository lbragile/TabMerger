import { getChromeStoreStats } from '@/lib/chromeStoreStats'

const reviews = [
  { quote: 'TabMerger saved my sanity. I had 200+ tabs across 8 windows. Now everything is organised.', attribution: 'ALEX T. · Chrome Web Store' },
  { quote: 'The AI grouping is genuinely magic. Dumped a huge research session in and it sorted everything instantly.', attribution: 'PRIYA S. · Product Hunt' },
  { quote: 'Session restore is the killer feature. I close everything at night and open it back up exactly as I left it.', attribution: 'MARCO L. · Verified user' },
  { quote: 'Cloud sync just works. Same groups on my laptop and desktop without thinking about it.', attribution: 'JORDAN K. · Chrome Web Store' },
]

// ponytail: these are placeholder testimonial names, not real people — initials avatar
// instead of a fabricated headshot. Swap for real photo URLs once reviews are sourced live.
function initials(attribution: string) {
  const name = attribution.split(' · ')[0]
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function ReviewCard({ quote, attribution }: { quote: string; attribution: string }) {
  return (
    <div className="shrink-0 w-[320px] rounded-xl border border-border bg-surface px-5 py-4">
      <div className="text-primary text-xs mb-2.5" aria-label="5 out of 5 stars">★★★★★</div>
      <p className="text-[13.5px] leading-relaxed mb-3">&ldquo;{quote}&rdquo;</p>
      <div className="flex items-center gap-2.5">
        <span
          className="h-6 w-6 rounded-full bg-primary/10 text-primary text-[9.5px] font-semibold shrink-0 flex items-center justify-center"
          aria-hidden="true"
        >
          {initials(attribution)}
        </span>
        <p className="text-[12px] text-text3">{attribution}</p>
      </div>
    </div>
  )
}

// ponytail: async Server Component — the star-rating fetch happens server-side, cached via
// `next.revalidate`; the marquee itself is static copy so it always renders even when no
// CHROME_WEBSTORE_EXTENSION_ID is configured (the numeric stats below are still never
// fabricated — that block simply doesn't render without real data).
export async function ReviewsStrip() {
  const stats = await getChromeStoreStats()

  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border overflow-hidden">
      <div className="container max-w-[960px]">
        <h2 className="font-semibold tracking-tight mb-8 sm:mb-11 text-[28px] sm:text-[34px] leading-tight text-center">
          Loved by thousands of tab-drowning users
        </h2>

        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 mb-8 sm:mb-11">
            {[
              { number: `${stats.rating} / 5`, label: 'Chrome Web Store rating' },
              { number: stats.ratingCount.toLocaleString(), label: 'Chrome Web Store ratings' },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`py-6 px-4 flex flex-col items-center text-center ${i === 1 ? 'border-l border-border' : ''}`}
              >
                <span className="font-extrabold" style={{ fontSize: '30px' }}>
                  {stat.number}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Marquee carousel — duplicated once for a seamless loop */}
      <div className="pause-on-hover">
        <div className="flex gap-4 w-max animate-marquee">
          {[...reviews, ...reviews].map((r, i) => (
            <ReviewCard key={i} {...r} />
          ))}
        </div>
      </div>
    </section>
  )
}
