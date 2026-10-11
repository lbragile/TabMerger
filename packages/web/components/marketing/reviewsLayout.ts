/**
 * Sizes and box classes of the landing page's reviews section, shared by the loaded section
 * (`ReviewsStrip`, `ReviewCard`, `ReviewsCarousel`) and its loading placeholder
 * (`ReviewsStripSkeleton`). The placeholder must occupy exactly the space the loaded section
 * does, or everything below it jumps when the reviews arrive: change a box here and both
 * follow.
 *
 * A plain module on purpose. The carousel is a client component, and a server component
 * importing a value from a client module gets a client reference, not the value.
 */

/** The section's `<h2>`. The carousel region is labelled by it. */
export const REVIEWS_HEADING_ID = 'reviews-heading'
export const REVIEWS_HEADING_TEXT = 'What people are saying'

export const REVIEWS_SECTION_CLASS = 'py-16 sm:py-[72px] px-6 sm:px-11 border-b border-border overflow-hidden'
export const REVIEWS_CONTAINER_CLASS = 'container max-w-[960px]'
export const REVIEWS_HEADING_CLASS =
  'font-semibold tracking-tight mb-8 sm:mb-11 text-[1.75rem] sm:text-[2.125rem] leading-tight text-center'

/** The two headline figures. */
export const STATS_GRID_CLASS = 'grid grid-cols-1 sm:grid-cols-2'
/** The gap under the figures when the per-store tiles follow them. */
export const STATS_WITH_BREAKDOWN_CLASS = 'mb-4'
export const STAT_BLOCK_CLASS = 'py-6 px-4 flex flex-col items-center text-center'
export const STAT_SECOND_BLOCK_CLASS = 'sm:border-l border-border'
export const STAT_NUMBER_CLASS = 'font-extrabold text-[1.875rem]'
export const STAT_LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1'

/** The per-store tiles under the headline. BREAKDOWN_CLASS is the gap above the carousel. */
export const BREAKDOWN_CLASS = 'mb-8 sm:mb-11'
export const BREAKDOWN_CAPTION_TEXT = 'By store'
export const BREAKDOWN_CAPTION_CLASS = 'mb-3 text-center text-[0.6875rem] font-semibold uppercase tracking-wider text-text3'
export const TILES_GRID_CLASS = 'mx-auto grid grid-cols-1 gap-3'
export const TILES_THREE_COLUMNS_CLASS = 'sm:grid-cols-3'
export const TILES_TWO_COLUMNS_CLASS = 'max-w-[40rem] sm:grid-cols-2'
export const TILE_BOX_CLASS = 'flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3'
export const TILE_NAME_LINE_CLASS = 'text-[0.8125rem] font-medium leading-5'
export const TILE_COUNT_LINE_CLASS = 'text-[0.75rem] leading-4'
export const TILE_RATING_CLASS = 'text-[1.125rem] font-bold leading-6 tabular-nums'

/**
 * Card width and the track's gap, at full size: a 20rem card and `gap-4`. Only
 * `buildMarqueeTrack` (server) still sizes anything with constants; the carousel measures
 * the real stride in the browser, because the card narrows on a small screen.
 */
export const CARD_STRIDE_PX = 320 + 16

/**
 * The stride at the narrowest screen the layout is checked at: 320px wide, where the strip
 * and so the card are 272px. `buildMarqueeTrack` sizes the loop with this one, so that half
 * the track still covers its minimum width when the cards are at their narrowest.
 */
export const MIN_CARD_STRIDE_PX = 272 + 16

/**
 * A review card's box. The width is 20rem, or the whole strip when the strip is narrower
 * than that, so a card is never wider than what can be seen (it was a fixed 320px, cut off
 * at the right on a 320px screen). `100cqw` is the width of the nearest `@container`
 * ancestor: CAROUSEL_VIEWPORT_CLASS. The `100vw - 3rem` form is the same figure for browsers
 * without container units (the section's `px-6` on each side), and is only approximate when
 * a classic scrollbar takes part of the viewport.
 */
export const CARD_BOX_CLASS =
  'shrink-0 w-[min(20rem,calc(100vw-3rem))] supports-[width:1cqw]:w-[min(20rem,100cqw)] h-[228px] rounded-xl border border-border bg-surface px-5 py-4'

/** The strip: a clipping viewport (the cards' size container) around the moving track. */
export const CAROUSEL_VIEWPORT_CLASS = '@container overflow-hidden'
export const CAROUSEL_TRACK_CLASS = 'flex gap-4 w-max'
