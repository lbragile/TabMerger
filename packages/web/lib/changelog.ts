import fs from 'node:fs'
import path from 'node:path'

export type ChangeType = 'New' | 'Improved' | 'Fixed'

export interface ChangeEntry {
  version: string
  date: string
  changes: { type: ChangeType; text: string }[]
}

/**
 * Filters out prerelease versions (`-beta.N` / `-alpha.N` / `-rc.N`). The public
 * changelog lists stable releases only — semantic-release's beta channel
 * (see `.claude/plans/release-and-beta-channel-spec.md` §3) is not a
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

/**
 * Resolves the path to the repo-root `CHANGELOG.md` that `@semantic-release/changelog`
 * owns. Next.js runs this package's build (and dev server) with `process.cwd()`
 * at `packages/web` in this pnpm monorepo — the same assumption `next.config.ts`
 * already makes for the Turbopack workspace root — so the repo root is two
 * directories up. Verified by inspecting `next.config.ts`'s
 * `path.resolve(process.cwd(), '../..')` comment, which documents this exact cwd.
 */
function changelogPath(): string {
  return path.resolve(process.cwd(), '../..', 'CHANGELOG.md')
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

function cleanCommitText(raw: string): string {
  let text = raw.trim()
  // Drop the trailing commit-hash link semantic-release appends, e.g.
  // " ([abc1234](https://github.com/owner/repo/commit/abc1234))"
  text = text.replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/i, '')
  // A bold commit scope becomes a plain-text prefix, e.g. "**popup:** " -> "popup: "
  // (the bold markup already contains the colon per commitPartial's `bold(`${scope}:`)`,
  // so strip any trailing colon before re-adding one rather than doubling it up).
  text = text.replace(/^\*\*([^*]+)\*\*\s*/, (_, scope: string) => `${scope.replace(/:$/, '')}: `)
  // Any other markdown link (issue references) — keep the link text, drop the URL
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  return text.trim()
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
        current = {
          version: `v${versionMatch[1]}`,
          date: dateMatch ? formatDate(dateMatch[1]) : '',
          changes: [],
        }
        currentType = null
        continue
      }
    }

    if (current && currentType) {
      const itemMatch = line.match(listItemRe)
      if (itemMatch) {
        const text = cleanCommitText(itemMatch[1])
        if (text) current.changes.push({ type: currentType, text })
      }
    }
  }
  if (current) entries.push(current)

  return entries.filter((entry) => !PRERELEASE_RE.test(entry.version) && entry.changes.length > 0)
}

// Module-scope memo: the /changelog route is dynamic (server-rendered per request — the
// shared marketing layout's Navbar calls the async Supabase server client), so without this,
// getGeneratedChangelog() would do a synchronous fs.readFileSync + full parse on every single
// request. A serverless instance loads this module once and reuses it across warm invocations,
// and a redeploy always gets a fresh instance (and therefore a fresh cache) — so there is no
// staleness risk from caching for the instance's lifetime. `undefined` means "not computed
// yet"; the ENOENT/no-file case is cached as `[]`, not left to re-read the filesystem on every
// request.
let cachedEntries: ChangeEntry[] | undefined

/**
 * Reads and parses the repo-root `CHANGELOG.md` that semantic-release owns, memoizing the
 * result for the lifetime of this module instance (see cache comment above).
 *
 * `CHANGELOG.md` does not exist until semantic-release's first run, which has
 * not happened yet in this repo (see spec §1/§6) — that absence is the normal
 * pre-launch state, not an error, so it resolves to "no generated entries yet"
 * rather than throwing. Any other read error still propagates (and is NOT cached,
 * so a transient error doesn't wrongly pin the page to legacy-only for the rest of
 * the instance's lifetime) so a real build misconfiguration isn't silently swallowed.
 */
export function getGeneratedChangelog(): ChangeEntry[] {
  if (cachedEntries) return cachedEntries

  let raw: string
  try {
    raw = fs.readFileSync(changelogPath(), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      cachedEntries = []
      return cachedEntries
    }
    throw err
  }
  cachedEntries = parseChangelog(raw)
  return cachedEntries
}
