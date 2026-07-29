import type { Metadata } from 'next'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Changelog — TabMerger',
  description: 'New features, improvements, and fixes in TabMerger.',
}

type ChangeType = 'New' | 'Improved' | 'Fixed'

interface ChangeEntry {
  version: string
  date: string
  changes: { type: ChangeType; text: string }[]
}

const CHANGELOG: ChangeEntry[] = [
  {
    version: 'v2.1.0',
    date: 'July 2026',
    changes: [
      { type: 'New', text: 'Tab notes — add a private note to any tab, visible in the preview panel' },
      { type: 'New', text: 'Onboarding checklist shown to new users on first open' },
      { type: 'New', text: 'AI Organize — automatically group open tabs by topic with one click (Pro AI)' },
      { type: 'New', text: 'Selection mode — multi-select tabs for bulk move, close, or send-to-group' },
      { type: 'Improved', text: 'Chrome-native tab groups are now imported automatically when you open the extension' },
      { type: 'Improved', text: 'Drag-and-drop polish: ghost preview, drop-zone highlight, and smoother reordering across windows' },
      { type: 'Fixed', text: 'Now Open group could briefly disappear during rapid tab open/close events' },
    ],
  },
  {
    version: 'v2.0.1',
    date: 'June 2026',
    changes: [
      { type: 'New', text: 'Context-menu integration — right-click any tab in Chrome to send it to a TabMerger group' },
      { type: 'New', text: 'Session save & restore — snapshot your entire workspace and reload it later (Pro)' },
      { type: 'Improved', text: 'Cloud sync reliability: conflict resolution now uses last-write-wins on a per-tab basis instead of per-group' },
      { type: 'Improved', text: 'Subscription lifecycle emails — confirmation on upgrade, reminder before renewal, receipt on charge' },
      { type: 'Fixed', text: 'Demo sync could overwrite real user data when the demo seed ran in a logged-in session' },
      { type: 'Fixed', text: 'Error boundary in the popup no longer swallows the underlying stack trace' },
    ],
  },
  {
    version: 'v2.0.0',
    date: 'May 2026',
    changes: [
      { type: 'New', text: 'Full rewrite as a pnpm monorepo: WXT-powered extension (MV3) + Next.js 15 marketing site + Supabase backend' },
      { type: 'New', text: 'Pro and Pro AI subscription tiers via Stripe — unlimited groups, cloud sync, and AI features' },
      { type: 'New', text: 'Tab preview cards with OG images, titles, and AI-generated summaries on hover (Pro AI)' },
      { type: 'New', text: 'Privacy Policy, Terms of Service, and Contact pages' },
      { type: 'Improved', text: 'Popup UI rebuilt in React with TanStack Query + Zustand; undo/redo stack with 10 snapshots' },
      { type: 'Improved', text: 'Free tier enforced in-extension: 5 groups, 50 tabs, local storage only' },
    ],
  },
]

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
  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <div className="mb-12 pb-8 border-b border-line">
        <p className="text-sm text-text3 mb-2">Product</p>
        <h1 className="text-4xl font-semibold tracking-tight mb-3">Changelog</h1>
        <p className="text-text2">Everything we shipped, newest first.</p>
      </div>

      <div className="flex flex-col">
        {CHANGELOG.map((entry) => {
          const major = isMajorVersion(entry.version)
          return (
            <div
              key={entry.version}
              id={anchorId(entry.version)}
              className={cn(
                'grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-6 sm:gap-8 py-7 border-t border-line scroll-mt-24',
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
                  <span className="inline-block mt-2 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary">
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
