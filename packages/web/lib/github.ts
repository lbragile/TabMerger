/** The public repository, as `owner/name`. The one place the web app spells it out. */
export const GITHUB_REPO = 'lbragile/TabMerger'

export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`

export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`

export const GITHUB_DISCUSSIONS_URL = `${GITHUB_REPO_URL}/discussions`

// The star badge's labels and number format are per locale: components/layout/githubLabels.ts.

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
