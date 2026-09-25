import { getChromeStoreStats } from '@/lib/chromeStoreStats'
import { getFirefoxAddonStats, type StoreReview } from '@/lib/firefoxAddonStats'
import { ReviewCard } from './ReviewCard'

/**
 * Everything shown here comes from a live store listing, verbatim — or it isn't
 * shown. This section previously rendered four invented testimonials attributed
 * to named people and to real platforms; don't reintroduce hardcoded quotes.
 *
 * Labels are store-neutral ("Average rating", "Ratings"). Leaving the store unnamed
 * is fine — the numbers are this product's real rating. What must never happen is
 * naming the WRONG store: Firefox figures must not be labelled as Chrome ones.
 */

interface Stats {
  rating: number
  ratingCount: number
  reviews: StoreReview[]
}

/**
 * Chrome is the primary listing. Firefox Add-ons is the fallback, used only when
 * Chrome yields nothing — its listing is currently unavailable (the store serves
 * an `empty-title` shell for it). The two are never merged into one figure:
 * averaging ratings across stores with different audiences and sample sizes would
 * produce a number neither store actually reports.
 */
async function loadStats(): Promise<Stats | null> {
  const chrome = await getChromeStoreStats()
  if (chrome) return { ...chrome, reviews: [] }

  const firefox = await getFirefoxAddonStats()
  if (firefox) return firefox

  return null
}

/**
 * About six cards are visible at once on a typical desktop. Below this many
 * UNIQUE reviews, the same quote reappears within a single screen, which reads as
 * padding. The marquee still renders with fewer — it just can't avoid that.
 * Repeats are never counted as unique; real reviews are the only source.
 */
export const MIN_UNIQUE_REVIEWS = 6

/**
 * The marquee keyframe slides the track by exactly -50%, so the loop is seamless
 * only when each half is at least as wide as the viewport. A handful of real
 * reviews makes a narrow half, which leaves a visible empty gap before the loop
 * restarts on a wide screen. So the reviews are repeated until one half clears
 * MIN_HALF_PX, and that half is then duplicated.
 *
 * Tracks ReviewCard's `w-[320px]` plus the track's `gap-4` (16px) — change these
 * together.
 */
const CARD_STRIDE_PX = 320 + 16
const MIN_HALF_PX = 2560 // covers a 2560px-wide viewport

export function buildMarqueeTrack<T>(items: T[]): T[] {
  if (items.length === 0) return []
  const repeats = Math.max(1, Math.ceil(MIN_HALF_PX / (items.length * CARD_STRIDE_PX)))
  const half = Array.from({ length: repeats }, () => items).flat()
  return [...half, ...half]
}

export async function ReviewsStrip() {
  const stats = await loadStats()
  if (!stats) return null

  const { reviews } = stats
  const track = buildMarqueeTrack(reviews)

  return (
    <section className="py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border overflow-hidden">
      <div className="container max-w-[960px]">
        <h2 className="font-semibold tracking-tight mb-8 sm:mb-11 text-[28px] sm:text-[34px] leading-tight text-center">
          What people are saying
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 mb-8 sm:mb-11">
          {[
            { number: `${stats.rating} / 5`, label: 'Average rating' },
            { number: stats.ratingCount.toLocaleString(), label: 'Ratings' },
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
      </div>

      {track.length > 0 && (
        <div className="pause-on-hover">
          <div className="flex gap-4 w-max animate-marquee">
            {track.map((r, i) => (
              <ReviewCard key={i} review={r} hidden={i >= reviews.length} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
