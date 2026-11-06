import { CHANGELOG_MARKDOWN } from '@/generated/changelog'
import { githubPullRequestUrl, githubReleaseUrl } from '@/lib/github'

export type ChangeType = 'New' | 'Improved' | 'Fixed'

export interface ChangeItem {
  type: ChangeType
  text: string
  /**
   * The pull request this change was merged in, when the changelog bullet names one.
   * Commits made straight to `main` before the PR workflow have none, and stay unlinked.
   */
  prNumber?: number
  /** That pull request's page on GitHub. Set together with `prNumber`. */
  prUrl?: string
}

export interface ChangeEntry {
  version: string
  date: string
  changes: ChangeItem[]
  /** The version's GitHub release page. Set only when that release really exists. */
  releaseUrl?: string
}

/**
 * Filters out prerelease versions (`-beta.N` / `-alpha.N` / `-rc.N`). The public
 * changelog lists stable releases only — semantic-release's beta channel
 * (prereleases cut from the `beta` branch) is not a
 * user-facing event and must never appear here.
 */
const PRERELEASE_RE = /-(?:beta|alpha|rc)\.\d+$/i

/**
 * Maps conventional-changelog-angular's generated section headings (the
 * default preset — `.releaserc.json` doesn't override it; see
 * `conventional-changelog-angular`'s `writer.js` `transform()`) onto this
 * page's New/Improved/Fixed badge taxonomy, per spec §6:
 * Features -> New, Performance/Reverts/refactor -> Improved, Bug Fixes -> Fixed.
 * Section types with no version-bumping commit type (docs, style, test,
 * build, ci, chore) never reach a release and are intentionally left
 * unmapped here rather than guessed at.
 */
const SECTION_TYPE: Record<string, ChangeType> = {
  Features: 'New',
  'Bug Fixes': 'Fixed',
  'Performance Improvements': 'Improved',
  Reverts: 'Improved',
  'Code Refactoring': 'Improved',
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The PR reference conventional-changelog appends after a squash-merged commit's subject,
 * e.g. ` ([#84](https://github.com/owner/repo/issues/84))`. The writer links the number to
 * `/issues/N` (GitHub redirects that to the PR); the number in the link text and the URL
 * must agree, so a stray markdown link that merely ends a subject isn't mistaken for one.
 */
const TRAILING_PR_RE = /\s*\(\[#(\d+)\]\(https:\/\/github\.com\/[^\s)]+\/(?:issues|pull)\/\1\)\)\s*$/i

/**
 * Turns one changelog bullet into display text, plus its PR number when the bullet has one.
 * The PR link is rebuilt from the number against this repo rather than copied from the file,
 * and points at `/pull/N` directly instead of relying on GitHub's `/issues/N` redirect.
 */
function cleanCommitText(raw: string): Omit<ChangeItem, 'type'> {
  let text = raw.trim()
  // Drop the trailing commit-hash link semantic-release appends, e.g.
  // " ([abc1234](https://github.com/owner/repo/commit/abc1234))". Commits made straight to
  // main (before the PR workflow) have only this link, and are deliberately left unlinked.
  text = text.replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/i, '')
  // A squash-merged PR's number sits just before the commit link: keep it as its own field.
  // Only the captured digits are used, and only when they make a valid PR number (not #0, not
  // past the safe-integer range); otherwise the reference stays in the text, unlinked.
  let prNumber: number | undefined
  let prUrl: string | undefined
  text = text.replace(TRAILING_PR_RE, (match: string, n: string) => {
    const url = githubPullRequestUrl(Number(n))
    if (!url) return match
    prNumber = Number(n)
    prUrl = url
    return ''
  })
  // A bold commit scope becomes a plain-text prefix, e.g. "**popup:** " -> "popup: "
  // (the bold markup already contains the colon per commitPartial's `bold(`${scope}:`)`,
  // so strip any trailing colon before re-adding one rather than doubling it up).
  text = text.replace(/^\*\*([^*]+)\*\*\s*/, (_, scope: string) => `${scope.replace(/:$/, '')}: `)
  // Any other markdown link (issue references) — keep the link text, drop the URL
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.trim()
  return prNumber === undefined || prUrl === undefined ? { text } : { text, prNumber, prUrl }
}

/**
 * Parses the markdown `@semantic-release/release-notes-generator` produces
 * with the default `conventional-changelog-angular` preset. Pure function of
 * the file contents so it's testable without touching the filesystem.
 *
 * Expected shape per release, oldest detail first:
 * ```
 * # [2.2.0](https://github.com/owner/repo/compare/v2.1.0...v2.2.0) (2026-10-01)
 *
 * ### Features
 *
 * * **popup:** add drag and drop reordering ([abc1234](.../commit/abc1234))
 *
 * ### Bug Fixes
 *
 * * fix something ([abc1234](.../commit/abc1234))
 * ```
 * Patch-only releases use `##` instead of `#` for the heading level
 * (conventional-changelog-writer's `isPatch` flag) — both are accepted.
 */
export function parseChangelog(raw: string): ChangeEntry[] {
  const lines = raw.split(/\r?\n/)
  const entries: ChangeEntry[] = []
  let current: ChangeEntry | null = null
  let currentType: ChangeType | null = null

  const releaseHeadingRe = /^#{1,2}\s+(.*)$/
  const sectionHeadingRe = /^#{3}\s+(.*)$/
  const listItemRe = /^[*-]\s+(.*)$/
  const versionRe = /\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\]?/
  const dateRe = /\((\d{4}-\d{2}-\d{2})\)\s*$/

  for (const line of lines) {
    const sectionMatch = line.match(sectionHeadingRe)
    if (sectionMatch) {
      currentType = SECTION_TYPE[sectionMatch[1].trim()] ?? null
      continue
    }

    const releaseMatch = line.match(releaseHeadingRe)
    if (releaseMatch) {
      const text = releaseMatch[1]
      const versionMatch = text.match(versionRe)
      if (versionMatch) {
        if (current) entries.push(current)
        const dateMatch = text.match(dateRe)
        const version = `v${versionMatch[1]}`
        current = {
          version,
          date: dateMatch ? formatDate(dateMatch[1]) : '',
          changes: [],
          // Every version semantic-release writes here also gets a GitHub release
          // (`@semantic-release/github` in `.releaserc.json`), tagged `v` + the version.
          releaseUrl: githubReleaseUrl(version),
        }
        currentType = null
        continue
      }
    }

    if (current && currentType) {
      const itemMatch = line.match(listItemRe)
      if (itemMatch) {
        const item = cleanCommitText(itemMatch[1])
        if (item.text) current.changes.push({ type: currentType, ...item })
      }
    }
  }
  if (current) entries.push(current)

  return entries.filter((entry) => !PRERELEASE_RE.test(entry.version) && entry.changes.length > 0)
}

// Module-scope memo: the /changelog route is dynamic (server-rendered per request: the shared
// marketing layout's Navbar calls the async Supabase server client), so without this every
// request would re-parse the whole changelog. The text is fixed for the life of a deployment, so
// caching it for the instance's lifetime can't go stale.
let cachedEntries: ChangeEntry[] | undefined

/**
 * The stable releases in the repo-root `CHANGELOG.md` that semantic-release owns, parsed once
 * per server instance.
 *
 * The markdown is copied into `generated/changelog.ts` at build time
 * (`scripts/generate-changelog.mjs`, run from next.config.ts), so nothing here touches the
 * filesystem: the page works on hosts that have none. A missing generated module fails the
 * build at the import above rather than quietly showing only the older, hand-written entries.
 */
export function getGeneratedChangelog(): ChangeEntry[] {
  cachedEntries ??= parseChangelog(CHANGELOG_MARKDOWN)
  return cachedEntries
}
