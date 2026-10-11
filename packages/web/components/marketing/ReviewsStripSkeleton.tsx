import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { listNames, STORE_BROWSER, STORE_IDS, STORE_LABEL } from '@/lib/stores'
import {
  BREAKDOWN_CAPTION_CLASS,
  BREAKDOWN_CAPTION_TEXT,
  BREAKDOWN_CLASS,
  CARD_BOX_CLASS,
  CARD_STRIDE_PX,
  CAROUSEL_TRACK_CLASS,
  CAROUSEL_VIEWPORT_CLASS,
  REVIEWS_CONTAINER_CLASS,
  REVIEWS_HEADING_CLASS,
  REVIEWS_HEADING_ID,
  REVIEWS_HEADING_TEXT,
  REVIEWS_SECTION_CLASS,
  STAT_BLOCK_CLASS,
  STAT_LABEL_CLASS,
  STAT_NUMBER_CLASS,
  STAT_SECOND_BLOCK_CLASS,
  STATS_GRID_CLASS,
  STATS_WITH_BREAKDOWN_CLASS,
  TILE_BOX_CLASS,
  TILE_COUNT_LINE_CLASS,
  TILE_NAME_LINE_CLASS,
  TILE_RATING_CLASS,
  TILES_GRID_CLASS,
  TILES_THREE_COLUMNS_CLASS,
} from './reviewsLayout'

/**
 * What the reviews section shows while the stores are being asked for their figures. The
 * landing page streams: everything else is sent at once and this stands in for the section
 * until its data arrives (see the `<Suspense>` in `app/(marketing)/page.tsx`).
 *
 * It takes up exactly the space the loaded section does, so nothing below it moves when the
 * two are swapped. That is why it is built from the same boxes (`./reviewsLayout`) and why
 * the text placeholders hold real text: a bar the size of the words it stands for wraps
 * where they wrap. It assumes the usual result, all three stores answering. With fewer the
 * loaded section is a little shorter, and with none it is absent: the placeholder is then
 * replaced by nothing.
 *
 * For assistive tech: the section is `aria-busy`, says "Loading reviews" once in text, and
 * hides every placeholder. Nothing is a live region, so the swap is not announced and focus
 * is not moved.
 */

/** Enough cards to fill a 2560px-wide screen. */
const PLACEHOLDER_CARDS = Math.ceil(2560 / CARD_STRIDE_PX)

const pulse = 'motion-reduce:animate-none'

/**
 * A bar exactly the size of the text it stands for: the text is laid out, wrapping
 * included, but not painted. The colour is set inline because the shared classes carry a
 * text colour of their own, and which of two colour classes wins is not ours to decide.
 */
function TextBar({ className, children }: { className?: string; children: string }) {
  return (
    <Skeleton className={cn(pulse, 'select-none', className)} style={{ color: 'transparent' }}>
      {children}
    </Skeleton>
  )
}

export function ReviewsStripSkeleton() {
  const stats = [
    { number: '0.00 / 5', label: 'Average rating' },
    { number: '00', label: `Ratings across ${listNames(STORE_IDS.map((id) => STORE_BROWSER[id]))}` },
  ]

  return (
    <section aria-busy="true" className={REVIEWS_SECTION_CLASS} data-testid="reviews-skeleton">
      <div className={REVIEWS_CONTAINER_CLASS}>
        {/* The heading needs no data, so it is the real one from the start. */}
        <h2 id={REVIEWS_HEADING_ID} className={REVIEWS_HEADING_CLASS}>
          {REVIEWS_HEADING_TEXT}
        </h2>
        <p className="sr-only">Loading reviews</p>

        <div aria-hidden="true">
          <div className={`${STATS_GRID_CLASS} ${STATS_WITH_BREAKDOWN_CLASS}`}>
            {stats.map((stat, i) => (
              <div key={stat.label} className={`${STAT_BLOCK_CLASS} ${i === 1 ? STAT_SECOND_BLOCK_CLASS : ''}`}>
                <TextBar className={STAT_NUMBER_CLASS}>{stat.number}</TextBar>
                <TextBar className={STAT_LABEL_CLASS}>{stat.label}</TextBar>
              </div>
            ))}
          </div>

          <div className={BREAKDOWN_CLASS}>
            <div className="flex justify-center">
              <TextBar className={BREAKDOWN_CAPTION_CLASS}>{BREAKDOWN_CAPTION_TEXT}</TextBar>
            </div>
            <div className={`${TILES_GRID_CLASS} ${TILES_THREE_COLUMNS_CLASS}`}>
              {STORE_IDS.map((id) => (
                <div key={id} className={`${TILE_BOX_CLASS} min-w-0`}>
                  <Skeleton className={`${pulse} h-6 w-6 shrink-0`} />
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <TextBar className={`max-w-full truncate ${TILE_NAME_LINE_CLASS}`}>{STORE_LABEL[id]}</TextBar>
                    <TextBar className={TILE_COUNT_LINE_CLASS}>00 ratings</TextBar>
                  </div>
                  <TextBar className={`shrink-0 ${TILE_RATING_CLASS}`}>0.00 / 5</TextBar>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div aria-hidden="true" className={CAROUSEL_VIEWPORT_CLASS}>
        <div className={CAROUSEL_TRACK_CLASS}>
          {Array.from({ length: PLACEHOLDER_CARDS }, (_, i) => (
            <div key={i} className={`${CARD_BOX_CLASS} flex flex-col gap-3`}>
              <Skeleton className={`${pulse} h-4 w-2/3`} />
              <Skeleton className={`${pulse} h-3 w-full`} />
              <Skeleton className={`${pulse} h-3 w-full`} />
              <Skeleton className={`${pulse} h-3 w-4/5`} />
              <Skeleton className={`${pulse} mt-auto h-3 w-1/2`} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
