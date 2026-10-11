import { STABLE_STORE_LINKS, storeLinkProps } from '@/lib/storeLinks'
import { formatRating, getStoreRatings, type StoreRating } from '@/lib/storeRatings'
import { listNames, STORE_BROWSER, STORE_LABEL } from '@/lib/stores'
import { STORE_ICON } from './BrowserIcons'
import { ReviewCard } from './ReviewCard'
import { ReviewsCarousel } from './ReviewsCarousel'
import {
  BREAKDOWN_CAPTION_CLASS,
  BREAKDOWN_CAPTION_TEXT,
  BREAKDOWN_CLASS,
  STAT_SECOND_BLOCK_CLASS,
  STATS_WITH_BREAKDOWN_CLASS,
  MIN_CARD_STRIDE_PX,
  REVIEWS_CONTAINER_CLASS,
  REVIEWS_HEADING_CLASS,
  REVIEWS_HEADING_ID,
  REVIEWS_HEADING_TEXT,
  REVIEWS_SECTION_CLASS,
  STAT_BLOCK_CLASS,
  STAT_LABEL_CLASS,
  STAT_NUMBER_CLASS,
  STATS_GRID_CLASS,
  TILE_BOX_CLASS,
  TILE_COUNT_LINE_CLASS,
  TILE_NAME_LINE_CLASS,
  TILE_RATING_CLASS,
  TILES_GRID_CLASS,
  TILES_THREE_COLUMNS_CLASS,
  TILES_TWO_COLUMNS_CLASS,
} from './reviewsLayout'

/**
 * Everything shown here comes from a live store listing, verbatim — or it isn't
 * shown. This section previously rendered four invented testimonials attributed
 * to named people and to real platforms; don't reintroduce hardcoded quotes.
 *
 * Decision: the section draws on all three public listings (Chrome Web Store, Firefox
 * Add-ons, Microsoft Edge Add-ons), always the stable ones, on every deployment.
 *
 * - The headline is one figure across the stores that returned data: the mean of their
 *   ratings weighted by rating count, and the sum of the counts. Weighting by count makes
 *   it the mean of every individual rating given, not an average of three averages (see
 *   `combineRatings`), so it is a figure the ratings really produce.
 * - Each store's own rating and count are listed under it, linked to that store. No
 *   single store reports the combined figure, so a reader can see what it is made of and
 *   check each part at its source.
 * - Reviews from every store that supplies texts share one carousel, each card naming
 *   its store.
 *
 * What must never happen is a figure or a review shown under the WRONG store's name. The
 * headline names only the stores that actually returned data; one that failed is left out
 * of the label, the breakdown and the mean alike.
 */

/**
 * About six cards are visible at once on a typical desktop. Below this many
 * UNIQUE reviews, the same quote reappears within a single screen, which reads as
 * padding. The marquee still renders with fewer — it just can't avoid that.
 * Repeats are never counted as unique; real reviews are the only source.
 */
export const MIN_UNIQUE_REVIEWS = 6

/**
 * The carousel wraps its offset at half the track's width, so the loop is seamless
 * only when the two halves are identical and each is at least as wide as the
 * viewport. A handful of real reviews makes a narrow half, which leaves a visible
 * empty gap on a wide screen. So the reviews are repeated until one half clears
 * MIN_HALF_PX, and that half is then duplicated.
 *
 * This runs on the server, where the card's real width isn't known (it narrows on a small
 * screen), so the count assumes the narrowest card: narrower cards need more repeats to
 * cover the same width, never fewer.
 */
const MIN_HALF_PX = 2560 // covers a 2560px-wide viewport

export function buildMarqueeTrack<T>(items: T[]): T[] {
  if (items.length === 0) return []
  const repeats = Math.max(1, Math.ceil(MIN_HALF_PX / (items.length * MIN_CARD_STRIDE_PX)))
  const half = Array.from({ length: repeats }, () => items).flat()
  return [...half, ...half]
}

// Lives in `lib/stores.ts` so the loading placeholder can word its label the same way.
export { listNames }

const formatCount = (count: number) => count.toLocaleString('en-US')
const ratingsNoun = (count: number) => (count === 1 ? 'rating' : 'ratings')

/**
 * The two headline figures and their labels. With several stores they are the combined
 * figures, labelled as spanning those stores. With one store they are that store's own,
 * under its own name. `outOfFive` marks the rating, which is written "4.23 / 5".
 */
function headlineStats(stores: StoreRating[], rating: number, ratingCount: number) {
  if (stores.length === 1) {
    const label = STORE_LABEL[stores[0].store]
    return [
      { value: formatRating(rating), outOfFive: true, label: `Average rating on ${label}` },
      {
        value: formatCount(ratingCount),
        outOfFive: false,
        label: `${ratingCount === 1 ? 'Rating' : 'Ratings'} on ${label}`,
      },
    ]
  }
  return [
    { value: formatRating(rating), outOfFive: true, label: 'Average rating' },
    {
      value: formatCount(ratingCount),
      outOfFive: false,
      label: `Ratings across ${listNames(stores.map((s) => STORE_BROWSER[s.store]))}`,
    },
  ]
}

/**
 * "/ 5" for the eye, "out of 5" for a screen reader, which would otherwise read the figure
 * as "4.23 slash 5", or drop the slash and say "4.23 5".
 */
function OutOfFive({ leadingSpace = false }: { leadingSpace?: boolean }) {
  return (
    <>
      <span aria-hidden="true">{leadingSpace ? ' / 5' : '/ 5'}</span>
      <span className="sr-only"> out of 5</span>
    </>
  )
}

const BREAKDOWN_CAPTION_ID = 'reviews-by-store'

/** Read by a screen reader between the parts of a tile, which are only laid out apart. */
const SpokenComma = () => <span className="sr-only">, </span>

/**
 * One store's own figures, under the headline they add up to. The whole tile is a link to
 * that store's stable listing, where the figure can be checked.
 *
 * Its accessible name is its visible text, in the order it is shown, with the gaps a
 * sighted reader sees turned into words: "Chrome Web Store, 28 ratings, 4.57 out of 5
 * (opens in a new tab)". There is no `aria-label`: one would replace the visible words, and
 * someone using voice control says what they see. The icon is decoration next to the
 * written name.
 */
function StoreTile({ store }: { store: StoreRating }) {
  const Icon = STORE_ICON[store.store]
  const label = STORE_LABEL[store.store]
  const rating = formatRating(store.rating)
  const count = `${formatCount(store.ratingCount)} ${ratingsNoun(store.ratingCount)}`
  const linkProps = storeLinkProps(STABLE_STORE_LINKS[store.store])

  return (
    <a
      {...linkProps}
      // The ring is the text colour, not the brand cyan: in the light theme that is under
      // 3:1 against the page.
      className={`${TILE_BOX_CLASS} transition-colors hover:border-border2 hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
    >
      <span aria-hidden="true" className="shrink-0 [&>svg]:block [&>svg]:h-6 [&>svg]:w-6">
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className={`truncate ${TILE_NAME_LINE_CLASS} text-text2`}>
          {label}
          <SpokenComma />
        </span>
        <span className={`${TILE_COUNT_LINE_CLASS} text-text3`}>
          {count}
          <SpokenComma />
        </span>
      </span>
      <span className="flex shrink-0 items-baseline gap-1">
        <span className={`${TILE_RATING_CLASS} text-foreground`}>{rating}</span>
        <span className="text-[0.75rem] text-text3">
          <OutOfFive />
        </span>
      </span>
      {linkProps.target === '_blank' && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  )
}

export async function ReviewsStrip() {
  const ratings = await getStoreRatings()
  if (!ratings) return null

  const { stores, reviews } = ratings
  const track = buildMarqueeTrack(reviews)
  // One store's breakdown would only repeat the headline, which already names it.
  const showBreakdown = stores.length > 1

  return (
    <section className={REVIEWS_SECTION_CLASS}>
      <div className={REVIEWS_CONTAINER_CLASS}>
        <h2 id={REVIEWS_HEADING_ID} className={REVIEWS_HEADING_CLASS}>
          {REVIEWS_HEADING_TEXT}
        </h2>

        <div className={`${STATS_GRID_CLASS} ${showBreakdown ? STATS_WITH_BREAKDOWN_CLASS : BREAKDOWN_CLASS}`}>
          {headlineStats(stores, ratings.rating, ratings.ratingCount).map((stat, i) => (
            <div key={stat.label} className={`${STAT_BLOCK_CLASS} ${i === 1 ? STAT_SECOND_BLOCK_CLASS : ''}`}>
              <span className={STAT_NUMBER_CLASS}>
                {stat.value}
                {stat.outOfFive && <OutOfFive leadingSpace />}
              </span>
              <span className={STAT_LABEL_CLASS}>{stat.label}</span>
            </div>
          ))}
        </div>

        {showBreakdown && (
          <div className={BREAKDOWN_CLASS}>
            <p id={BREAKDOWN_CAPTION_ID} className={BREAKDOWN_CAPTION_CLASS}>
              {BREAKDOWN_CAPTION_TEXT}
            </p>
            {/* Three stores fill the row; two sit centred at the same tile width.
                role="list": Tailwind's reset sets `list-style: none`, and Safari then stops
                announcing the element as a list. */}
            <ul
              role="list"
              aria-labelledby={BREAKDOWN_CAPTION_ID}
              className={`${TILES_GRID_CLASS} ${stores.length === 2 ? TILES_TWO_COLUMNS_CLASS : TILES_THREE_COLUMNS_CLASS}`}
            >
              {stores.map((s) => (
                <li key={s.store} className="min-w-0">
                  <StoreTile store={s} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {track.length > 0 && (
        <ReviewsCarousel labelledBy={REVIEWS_HEADING_ID}>
          {track.map((r, i) => (
            <ReviewCard key={i} review={r} hidden={i >= reviews.length} />
          ))}
        </ReviewsCarousel>
      )}
    </section>
  )
}
