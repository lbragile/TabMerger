/** The public repository, as `owner/name`. The one place the web app spells it out. */
export const GITHUB_REPO = 'lbragile/TabMerger'

export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`

export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`

export const GITHUB_DISCUSSIONS_URL = `${GITHUB_REPO_URL}/discussions`

const COMPACT_COUNT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const FULL_COUNT = new Intl.NumberFormat('en')

/** A star count as shown on the badge: 87 -> "87", 1234 -> "1.2K". */
export function formatStarCount(count: number): string {
  return COMPACT_COUNT.format(count)
}

/**
 * The accessible name of a link to the repository. With a count it states the exact number
 * ("TabMerger on GitHub, 1,234 stars"); without one (still loading, or GitHub couldn't be
 * read) it names the destination only, never a placeholder number.
 */
export function githubRepoLabel(count?: number | null): string {
  if (count === null || count === undefined) return 'TabMerger on GitHub'
  return `TabMerger on GitHub, ${FULL_COUNT.format(count)} ${count === 1 ? 'star' : 'stars'}`
}

/**
 * The GitHub release page for a version, e.g. `v3.1.2` ->
 * `https://github.com/lbragile/TabMerger/releases/tag/v3.1.2`. Release tags are `v` + the
 * version, so a bare `3.1.2` is accepted too.
 *
 * This only builds the URL: a tag that was never published as a release has no page behind
 * it, so callers decide which versions get a link.
 */
export function githubReleaseUrl(version: string): string {
  const tag = version.startsWith('v') ? version : `v${version}`
  return `${GITHUB_REPO_URL}/releases/tag/${encodeURIComponent(tag)}`
}
