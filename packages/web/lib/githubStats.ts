// Server-only: reads the public repository's star count from the GitHub REST API.
// Never call this from the browser: fetching on the server keeps visitors' IP addresses
// away from GitHub and lets one cached response serve every visitor.

import { GITHUB_REPO } from '@/lib/github'

/**
 * How long a star count is reused. Unauthenticated GitHub API calls are limited to 60 an
 * hour per IP address; one call an hour per server instance stays far under that, and a
 * star count an hour old is still accurate enough for a badge.
 */
export const GITHUB_STATS_REVALIDATE_SECONDS = 3600

/** A slow GitHub must not hold up the page: past this the badge renders without a count. */
const GITHUB_STATS_TIMEOUT_MS = 3000

const GITHUB_REPO_API_URL = `https://api.github.com/repos/${GITHUB_REPO}`

/**
 * The repository's star count, or null when it can't be read: a non-OK response (which
 * includes being rate limited), a network error or timeout, or a value that isn't a
 * non-negative whole number. Never throws and never makes up a number.
 *
 * Cached with Next's fetch data cache (`next.revalidate`). Only 200 responses are stored,
 * so a failure is retried on the next request instead of being pinned for an hour.
 */
export async function getGithubStarCount(): Promise<number | null> {
  try {
    const res = await fetch(GITHUB_REPO_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      next: { revalidate: GITHUB_STATS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(GITHUB_STATS_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const data = (await res.json()) as { stargazers_count?: unknown } | null
    const stars = data?.stargazers_count
    return typeof stars === 'number' && Number.isSafeInteger(stars) && stars >= 0 ? stars : null
  } catch {
    return null
  }
}
