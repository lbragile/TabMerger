import { useFormatter, useTranslations } from 'next-intl'

/**
 * The accessible name of a link to the repository. With a count it states the exact number
 * ("TabMerger on GitHub, 1,234 stars"); without one (still loading, or GitHub couldn't be
 * read) it names the destination only, never a placeholder number. A hook, usable from Server
 * and Client Components alike (neither caller is async).
 */
export function useGithubRepoLabel(count?: number | null): string {
  const t = useTranslations('nav')
  if (count === null || count === undefined) return t('githubRepo')
  return t('githubRepoWithStars', { count })
}

/** Formats a star count as shown on the badge: 87 -> "87", 1234 -> "1.2K" (in the active locale). */
export function useStarCount(): (count: number) => string {
  const format = useFormatter()
  return (count) => format.number(count, { notation: 'compact', maximumFractionDigits: 1 })
}
