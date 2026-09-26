import type { Metadata } from 'next'
import { cn } from '@/lib/utils'
import { getGeneratedChangelog, type ChangeEntry, type ChangeType } from '@/lib/changelog'

export const metadata: Metadata = {
  title: 'Changelog — TabMerger',
  description: 'New features, improvements, and fixes in TabMerger.',
}

// v3.0.0 is the version live on the Chrome Web Store, but its `v3.0.0` git tag is only
// an ANCHOR for semantic-release (created 2026-09-19 on the 2026-08-14 commit fcd85f9),
// so CHANGELOG.md has no generated section for it. Written by hand from the git history
// up to that commit; every item was checked against the code. AI features are left out
// on purpose while they're marked "coming soon". Releases after this are generated —
// don't add more entries here.
//
// The page used to show v2.0.0, v2.0.1 and v2.1.0 entries dated May–July 2026 that
// didn't match the history: no such releases existed, the rebuild they described
// started 2026-07-03, and several items weren't in the code. They're gone; the real
// v1.x–v2.x history follows below.

// The ORIGINAL extension (2020–2021), from its public repo: every tag on
// github.com/lbragile/TabMerger/tags (v1.2.0 … v2.0.0), described by the author's own
// GitHub release notes for that version, lightly reworded. Dates are the tagged commits'
// dates (all present in this repo's history); two releases were published on GitHub
// months later, so their publish dates aren't used. v1.4.1–v1.4.3 and v1.6.0–v1.6.2
// come from the combined notes on the v1.4.3 and v1.6.2 releases. Versions before
// v1.2.0 were never tagged. A "v3.0 refactor" started in 2021 was never released —
// v3.0.0 above is the 2026 rebuild. Historical record: don't edit.
const ORIGINAL_EXTENSION: ChangeEntry[] = [
  {
    version: 'v2.0.0',
    date: 'March 6, 2021',
    changes: [
      { type: 'New', text: 'Subscriptions' },
      { type: 'New', text: 'Automatic backups to a JSON file and to sync' },
      { type: 'New', text: 'Group color randomizer' },
      { type: 'New', text: 'Choose where to save a JSON export (can be turned off in settings)' },
      { type: 'Improved', text: 'Text style settings now apply to all text in TabMerger' },
      { type: 'Improved', text: 'Tooltips can be shown or hidden in settings' },
      { type: 'Improved', text: 'Many confirmation boxes replaced with notifications' },
      { type: 'Improved', text: 'Redesigned settings page, and more details relevant to you on the main page' },
      { type: 'Fixed', text: 'Keyboard shortcut and right-click merging on Firefox' },
    ],
  },
  {
    version: 'v1.6.2',
    date: 'February 16, 2021',
    changes: [
      { type: 'New', text: 'Adjustable tab title weight and font' },
      { type: 'New', text: 'Hover a tab title to see its URL' },
      { type: 'New', text: 'Search for groups with "@"' },
      { type: 'Improved', text: 'Right-click menu and keyboard shortcut merging' },
      { type: 'Improved', text: 'Clearer merge button icons, and tooltips that no longer cover other buttons' },
    ],
  },
  {
    version: 'v1.6.1',
    date: 'February 6, 2021',
    changes: [
      { type: 'Improved', text: 'Hidden and empty groups are left out of the printable PDF' },
      { type: 'Fixed', text: 'Bugs in the walkthrough' },
    ],
  },
  {
    version: 'v1.6.0',
    date: 'February 4, 2021',
    changes: [
      { type: 'New', text: 'Undo destructive actions' },
      { type: 'New', text: 'Drag and drop groups, and drag a site straight from the address bar into TabMerger' },
      { type: 'New', text: 'Lock, star, and persistently hide or show groups' },
      { type: 'New', text: 'Edit tab titles, and pin or unpin tabs from inside TabMerger' },
      { type: 'New', text: 'Walkthrough tour, and configurable badge icon information' },
      { type: 'New', text: 'Setting to keep tabs open or close them when merging' },
      { type: 'Improved', text: 'Confirmation before Delete All and Open All' },
      { type: 'Improved', text: 'Much longer group titles, preset colors in the color picker, and automatic text contrast' },
      { type: 'Improved', text: 'More forgiving JSON import, including files from similar apps' },
    ],
  },
  {
    version: 'v1.5.0',
    date: 'January 8, 2021',
    changes: [
      { type: 'New', text: 'Printable PDF via a print button' },
      { type: 'New', text: 'A faster new homepage' },
      { type: 'Improved', text: 'Cleaner interface, responsive on smaller screens in every browser' },
      { type: 'Improved', text: 'Scrolls to the bottom when you add a group' },
    ],
  },
  {
    version: 'v1.4.3',
    date: 'December 22, 2020',
    changes: [{ type: 'Fixed', text: 'Sync and incognito bugs (v1.4.1–v1.4.3)' }],
  },
  {
    version: 'v1.4.0',
    date: 'December 19, 2020',
    changes: [
      { type: 'Improved', text: 'More compact interface' },
      { type: 'Improved', text: 'One search filter, with regular expression support' },
      { type: 'Improved', text: 'Merging when opening tabs' },
      { type: 'Improved', text: 'PDF export removed for now, until its formatting is improved' },
    ],
  },
  {
    version: 'v1.3.0',
    date: 'December 15, 2020',
    changes: [
      { type: 'New', text: 'Sync your TabMerger configuration across devices' },
      { type: 'New', text: 'Works in incognito (private) windows' },
      { type: 'New', text: 'Restore settings to their defaults' },
      { type: 'Improved', text: 'Merging and restoring avoid duplicates' },
      { type: 'Improved', text: 'The page scrolls while you drag' },
      { type: 'Improved', text: 'Cleaner, more readable JSON export' },
    ],
  },
  {
    version: 'v1.2.1',
    date: 'December 7, 2020',
    changes: [
      { type: 'New', text: 'Import and export JSON, and export a PDF of your TabMerger page' },
      { type: 'New', text: 'Keyboard shortcuts' },
      { type: 'New', text: 'Available for Microsoft Edge, and more languages' },
      { type: 'Improved', text: 'Fewer unnecessary page reloads, and a better interface on Firefox and Chrome' },
    ],
  },
  {
    version: 'v1.2.0',
    date: 'December 3, 2020',
    changes: [
      { type: 'New', text: 'Merge tabs within each group directly' },
      { type: 'New', text: 'Filters to find tabs within a group' },
      { type: 'Improved', text: 'Merging no longer makes the page jump around' },
    ],
  },
]
const V3_0_0: ChangeEntry = {
  version: 'v3.0.0',
  date: 'August 14, 2026',
  changes: [
    { type: 'New', text: 'Rebuilt from the ground up — a new extension for Chrome, Firefox and Edge, plus a web app with your account and dashboard' },
    { type: 'New', text: 'Cloud sync across devices (Pro), end-to-end encrypted — your tabs are encrypted before they leave the browser, and only you hold the key' },
    { type: 'New', text: 'Sessions — save your whole workspace and restore it later' },
    { type: 'New', text: 'Share a group with a public link' },
    { type: 'New', text: 'URL rules — send matching tabs to a group automatically' },
    { type: 'New', text: 'Notes on groups and tabs, and reminders' },
    { type: 'New', text: 'Selection mode for moving, copying or closing many tabs at once' },
    { type: 'New', text: 'Keyboard shortcuts and a right-click menu to save the current tab, tabs to the left or right, or all other tabs' },
    { type: 'Improved', text: 'Chrome tab groups are imported when you open TabMerger' },
    { type: 'Improved', text: 'Tab previews with page images, search across groups, and undo/redo' },
    { type: 'Improved', text: 'Fewer permissions: TabMerger no longer asks to read and change data on the websites you visit' },
  ],
}

const badgeClass: Record<ChangeType, string> = {
  New: 'bg-ok-soft text-ok',
  Improved: 'bg-accent text-accent-foreground',
  Fixed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
}

// ponytail: a version is "major" (gets the hero treatment) when its patch and
// minor segments are both zero, e.g. v2.0.0 — matches semver convention.
function isMajorVersion(version: string) {
  return /^v\d+\.0\.0$/.test(version)
}

function anchorId(version: string) {
  return version.replace(/\./g, '-')
}

export default function ChangelogPage() {
  const entries = [...getGeneratedChangelog(), V3_0_0, ...ORIGINAL_EXTENSION]

  return (
    <div className="container py-16 max-w-3xl">
      <div className="mb-12 pb-8 border-b border-line">
        <h1 className="text-4xl font-semibold tracking-tight mb-3">Changelog</h1>
        <p className="text-text2">Everything we shipped, newest first.</p>
      </div>

      <div className="flex flex-col">
        {entries.map((entry, index) => {
          const major = isMajorVersion(entry.version)
          return (
            <div
              key={entry.version}
              id={anchorId(entry.version)}
              className={cn(
                'grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-6 sm:gap-8 py-7 border-t border-line scroll-mt-24',
                index === 0 && 'border-t-0',
                major && 'rounded-2xl border-t-0 -mx-6 px-6 py-8 mb-4 bg-surface2'
              )}
            >
              <div>
                <a
                  href={`#${anchorId(entry.version)}`}
                  className="font-mono font-semibold text-base tracking-tight hover:text-primary transition-colors"
                >
                  {entry.version}
                </a>
                <div className="text-xs text-text3 mt-1">{entry.date}</div>
                {major && (
                  <span className="inline-block mt-2 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/15 text-primary">
                    Major release
                  </span>
                )}
              </div>

              <ul className="flex flex-col gap-3">
                {entry.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide min-w-[64px] text-center',
                        badgeClass[change.type]
                      )}
                    >
                      {change.type}
                    </span>
                    <span className="text-text2 leading-relaxed">{change.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
