import { use } from 'react'
import { Star } from 'lucide-react'
import { GitHubMark } from '@/components/GitHubMark'
import { GITHUB_REPO_URL } from '@/lib/github'
import { useGithubRepoLabel, useStarCount } from '@/components/layout/githubLabels'
import { cn } from '@/lib/utils'

interface GithubBadgeProps {
  /** `undefined` while the count is loading, `null` when GitHub couldn't be read. */
  count?: number | null
  className?: string
}

/**
 * The link itself, in each of its three states. While loading it keeps the star and an
 * empty slot the width of a typical count, so the number arriving barely moves the header.
 * When there is no count to show it is the mark alone: no "0", no placeholder.
 */
function GithubBadge({ count, className }: GithubBadgeProps) {
  const repoLabel = useGithubRepoLabel(count)
  const formatStars = useStarCount()
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={repoLabel}
      className={cn(
        // A sibling of the theme toggle next to it: same height (h-9, as the size="sm"
        // buttons), border colour and radius.
        // Hidden below sm (the mobile panel has a GitHub row instead). From md to lg the bar
        // also holds the nav links and the sign-in buttons and has no room for the count, so
        // the badge shrinks to a square with the mark alone, the same box as the toggle; its
        // accessible name still states the count.
        'hidden h-9 items-center gap-1.5 rounded-md border border-border2 px-2.5 text-[0.8125rem] font-medium text-text2 transition-colors hover:bg-surface2 hover:text-foreground sm:inline-flex',
        'md:w-9 md:justify-center md:px-0 lg:w-auto lg:px-2.5',
        className,
      )}
    >
      <GitHubMark className="size-4 shrink-0" />
      {count !== null && (
        <span className="flex items-center gap-1 md:hidden lg:flex">
          <Star aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-[1.25rem] text-center tabular-nums">
            {count === undefined ? '' : formatStars(count)}
          </span>
        </span>
      )}
    </a>
  )
}

interface GithubStarsProps {
  /** Started by the navbar and not awaited there, so the header never waits for GitHub. */
  starsPromise: Promise<number | null>
  className?: string
}

/** The navbar's GitHub badge with the star count. Render inside `<Suspense>`. */
export function GithubStars({ starsPromise, className }: GithubStarsProps) {
  return <GithubBadge count={use(starsPromise)} className={className} />
}

/** The `<Suspense>` fallback for {@link GithubStars}: the same link, without a count yet. */
export function GithubStarsFallback({ className }: { className?: string }) {
  return <GithubBadge className={className} />
}
