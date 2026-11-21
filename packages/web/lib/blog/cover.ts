/**
 * The blog index card image (`post.cover`). Cards show it whole in a 4:3 frame (every TabMerger
 * capture is 1600×1200), never cropped or zoomed. The generator (scripts/generate-blog-index.mjs
 * `resolveCover`) checks covers at build time (file exists, within 2% of 4:3) and picks each
 * card's image; it has the same numbers.
 */

export const COVER_RATIO = 4 / 3
export const COVER_RATIO_TOLERANCE = 0.02

/** What a card shows: the image and its dark-theme version, if any. */
export interface CardCover {
  src: string
  srcDark?: string
}

/** Whether a width and height are within 2% of 4:3. */
export function isCoverRatio(width: number, height: number): boolean {
  return width > 0 && height > 0 && Math.abs(width / height / COVER_RATIO - 1) <= COVER_RATIO_TOLERANCE
}
