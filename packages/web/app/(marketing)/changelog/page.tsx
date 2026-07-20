import type { Metadata } from 'next'

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
  New: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Improved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Fixed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
}

export default function ChangelogPage() {
  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <div className="mb-10 pb-8 border-b">
        <p className="text-sm text-muted-foreground mb-2">Product</p>
        <h1 className="text-4xl font-bold tracking-tight mb-3">Changelog</h1>
        <p className="text-muted-foreground">New features, improvements, and fixes — newest first.</p>
      </div>

      {/* ponytail: plain relative div timeline, no library needed */}
      <div className="relative pl-6 border-l border-border space-y-12">
        {CHANGELOG.map((entry) => (
          <div key={entry.version} className="relative">
            {/* Timeline dot */}
            <div className="absolute -left-[1.8125rem] top-1 w-3 h-3 rounded-full bg-primary border-2 border-background" />

            <div className="mb-4 flex items-baseline gap-3">
              <span className="text-lg font-semibold">{entry.version}</span>
              <span className="text-sm text-muted-foreground">{entry.date}</span>
            </div>

            <ul className="space-y-2.5">
              {entry.changes.map((change, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass[change.type]}`}
                  >
                    {change.type}
                  </span>
                  <span className="text-muted-foreground leading-relaxed">{change.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
