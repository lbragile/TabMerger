/** Reading speed the blog's read time assumes (an adult reading prose on a screen). */
export const READ_WORDS_PER_MINUTE = 230

/**
 * Whole minutes to read `words` words, rounded up, at least 1. The word count comes from the
 * post's MDX source at build time (`countReadableWords` in scripts/generate-blog-index.mjs).
 */
export function readMinutes(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 1
  return Math.max(1, Math.ceil(words / READ_WORDS_PER_MINUTE))
}
