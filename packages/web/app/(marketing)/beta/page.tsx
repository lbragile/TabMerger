import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LegalToc } from '@/components/legal-toc'

export const metadata: Metadata = {
  title: 'Beta Program',
  description:
    'Join the TabMerger beta — install the private beta build, know what to test, and report bugs directly to the team.',
}

// The Google Group is also the Chrome Web Store trusted-tester list for the private
// BETA item. Joining it is what makes the private listing visible to that Google
// account (access can take a little while to appear after joining).
const BETA_GOOGLE_GROUP_URL = 'https://groups.google.com/g/tabmerger-beta-testers'

// TODO (owner): the private BETA Chrome Web Store listing URL depends on the beta
// item's extension ID, which is held only as the `CHROME_BETA_EXTENSION_ID` repo
// secret (see packages/extension/CHROMEWEBSTORE.md) and isn't checked into the repo.
// Fill this in once you have it, e.g.
// 'https://chromewebstore.google.com/detail/<BETA_EXTENSION_ID>'.
const BETA_STORE_LISTING_URL = ''

const GITHUB_REPO = 'lbragile/TabMerger'
const GITHUB_DISCUSSIONS_URL = `https://github.com/${GITHUB_REPO}/discussions`
// GitHub Discussions category slugs for this repo. There's no dedicated "Beta" category
// yet — Q&A is used for bug reports (it's "answerable," so a report can be marked
// resolved) and Ideas for feedback/suggestions. Switch BUG to a dedicated category slug
// once the repo owner creates one.
const BETA_BUG_DISCUSSION_CATEGORY = 'q-a'
const BETA_IDEA_DISCUSSION_CATEGORY = 'ideas'

const BUG_REPORT_TEMPLATE = `Summary:
Steps to reproduce:
1.
2.
3.
Expected:
Actual:
Beta version (Settings title badge or chrome://extensions):
Browser and OS:
Signed in: yes / no
Screenshots or screen recording:`

const IDEA_TEMPLATE = `Summary:
What would this help with:
Any workaround you're using today:`

function newDiscussionUrl(category: string, titlePrefix: string, body: string) {
  const params = new URLSearchParams({
    category,
    title: titlePrefix,
    body,
  })
  return `${GITHUB_DISCUSSIONS_URL}/new?${params.toString()}`
}

const BUG_REPORT_DISCUSSION_URL = newDiscussionUrl(
  BETA_BUG_DISCUSSION_CATEGORY,
  '[Beta bug] ',
  BUG_REPORT_TEMPLATE
)
const IDEA_DISCUSSION_URL = newDiscussionUrl(
  BETA_IDEA_DISCUSSION_CATEGORY,
  '[Beta idea] ',
  IDEA_TEMPLATE
)

const TOC = [
  { id: 'join', label: 'Join & install' },
  { id: 'what-to-test', label: 'What to test' },
  { id: 'report-bugs', label: 'Report a bug' },
  { id: 'faq', label: 'FAQ' },
]

type Example =
  | { kind: 'image'; src: string; width: number; height: number; alt: string; caption?: string }
  | { kind: 'ascii'; content: string; caption?: string }

type TestItem = {
  steps: string[]
  example?: Example
  good: string
  report?: string
}

const TEST_AREAS: {
  id: string
  title: string
  intro?: string
  items: TestItem[]
}[] = [
  {
    id: 'groups-and-tabs',
    title: 'Groups and tabs',
    items: [
      {
        steps: [
          'Click "Add Group" in the sidebar and give it a name.',
          'Click the colored dot next to the group to open the color picker, and pick a color.',
          'Save a few tabs into the group (drag them in, or use the right-click menu).',
          'Delete one tab, then click the Undo button (header, top right) and then Redo.',
        ],
        example: {
          kind: 'image',
          src: '/beta/color-new-group.webp',
          width: 536,
          height: 413,
          alt: 'TabMerger popup with a new group selected and its color picker open, showing 12 preset colors',
          caption: 'Clicking a group\'s color dot opens this picker.',
        },
        good: 'The group updates instantly; undo restores the deleted tab exactly where it was; redo removes it again.',
      },
      {
        steps: [
          'Open the popup and look at "Now Open" — it\'s always the first group in the sidebar.',
          'Open and close a few browser tabs without touching the popup.',
          'Reopen the popup and check "Now Open" again.',
        ],
        good: '"Now Open" tracks your real tabs without any manual refresh, and you can\'t delete or reorder it away from the top.',
      },
      {
        steps: [
          'Save an entire window into a group (drag the window\'s drag-handle onto a group, or use its "…" menu).',
          'Open the group and use the window\'s "…" menu to reopen it — as a new window, and as tabs in the current window, if both options are offered.',
        ],
        example: {
          kind: 'image',
          src: '/beta/multi-window.webp',
          width: 536,
          height: 413,
          alt: 'A TabMerger group with four separate saved windows, each holding one tab',
          caption: 'A group can hold several separate windows — each with its own tab count.',
        },
        good: 'All tabs reopen with the right titles and URLs, in the same order.',
      },
      {
        steps: [
          'Right-click a saved group in the sidebar and choose Archive.',
          'Open the "Archived" section at the bottom of the sidebar and find it.',
          'Restore it from there.',
        ],
        good: 'Archived groups disappear from the active list but are never deleted — they reappear exactly as they were once restored.',
      },
      {
        steps: [
          'Save a session — a named snapshot of your current groups (look for "Save Session" near the sidebar\'s Sessions area).',
          'Make some changes to your groups.',
          'Restore the saved session.',
        ],
        good: 'Restoring brings the groups back exactly as they were when you saved the session.',
      },
      {
        steps: [
          'Press Ctrl+K (Cmd+K on Mac) to open search.',
          'Type "ghub" (letters in order, not a full word) with a "GitHub" tab saved somewhere.',
          'Clear the search box.',
        ],
        example: {
          kind: 'ascii',
          caption: 'Search matches letters in order, not a substring — "ghub" still finds "GitHub".',
          content: `Search tabs and groups...  [ghub]                    Ctrl K
┌──────────────────────────────────────────────┐
│ TABS                                          │
│ ○ GitHub · Change is constant. GitHub...      │
│                                    github.com │
└──────────────────────────────────────────────┘

(Any tab whose title or URL doesn't contain
"g","h","u","b" in that order stays hidden.)`,
        },
        good: 'Tabs that don\'t match hide as you type, and clearing the search brings everything back.',
      },
      {
        steps: [
          'Open Settings and set the stale-tab threshold (e.g. 30 days).',
          'Wait for (or seed) at least 5 tabs older than that threshold.',
          'Look for the amber banner above the tab list and try both of its buttons: Review, then Remove stale.',
        ],
        example: {
          kind: 'ascii',
          caption: 'The stale-tab banner, and the confirmation Remove stale asks for.',
          content: `┌──────────────────────────────────────────────────┐
│ 5 tabs were saved over 30 days ago.  [Review] [Remove stale] ✕ │
└──────────────────────────────────────────────────┘

Clicking "Remove stale" (with delete confirmation on):
┌──────────────────────────────┐
│ Remove Stale Tabs             │
│ Are you sure you want to      │
│ remove 5 stale tabs? This      │
│ cannot be undone.              │
│                [Cancel] [Remove] │
└──────────────────────────────┘`,
        },
        good: 'Review shows exactly which tabs are stale, and Remove stale asks for confirmation before deleting anything (if "confirm before delete" is on in Settings).',
        report: 'A group you deleted or archived reappears on its own — that\'s the "resurrection" bug we\'re specifically hunting.',
      },
    ],
  },
  {
    id: 'drag-and-drop',
    title: 'Drag and drop',
    items: [
      {
        steps: ['Drag a single tab from one group into another.'],
        example: {
          kind: 'image',
          src: '/beta/cross-window-tab-drag.webp',
          width: 536,
          height: 413,
          alt: 'A tab being dragged from one saved window to another inside the same TabMerger group',
          caption: 'Dropping a tab onto another window inside the same group.',
        },
        good: 'The tab moves cleanly, its favicon/title stay intact, and the source group updates immediately.',
      },
      {
        steps: [
          'Select multiple tabs (Ctrl/Cmd-click or Shift-click to add to the selection).',
          'Drag the selection together into another group or window.',
        ],
        good: 'All selected tabs move together, keeping their relative order.',
      },
      {
        steps: [
          'Inside a group with several windows, drag a tab from one window card onto another window card (see the "cross-window" example above).',
        ],
        good: 'The tab lands in the target window at the spot you dropped it, and both windows\' tab counts update.',
      },
      {
        steps: ['Drag a tab out of the main panel and drop it directly onto a group in the sidebar.'],
        good: 'The tab is added to that group without needing to open the group first.',
      },
      {
        steps: [
          'Drag a group in the sidebar up or down to reorder it above or below another group.',
          'Close and reopen the popup.',
        ],
        good: 'The new order is remembered after closing and reopening the popup.',
      },
      {
        steps: [
          'Focus a tab or group row (Tab key, or click then Tab).',
          'Press Space to pick it up.',
          'Use the Arrow keys to move it, Space again to drop, or Escape to cancel.',
        ],
        good: 'You can reorder items with only a keyboard, with a clear announcement of what\'s happening (screen reader or visual cue) at each step.',
      },
    ],
  },
  {
    id: 'right-click-menu',
    title: 'Right-click menu',
    items: [
      {
        steps: [
          'On any webpage, right-click and open "Save to TabMerger".',
          'Try "Save this tab" first, then try saving to a specific existing group.',
        ],
        example: {
          kind: 'ascii',
          caption: 'The context menu lists your real groups, with color, window count, and tab count.',
          content: `Right-click → Save to TabMerger → Save this tab ▸
┌────────────────────────────────┐
│ 🟣 Work (1w · 5t)               │
│ 🔵 Research (1w · 4t)           │
│ 🟢 Shopping (1w · 3t)           │
│ 🟠 Reading List (1w · 5t)       │
└────────────────────────────────┘`,
        },
        good: 'The context menu lists your real groups by name and the tab appears in the chosen group right away.',
      },
      {
        steps: [
          'Create a brand-new group from the popup.',
          'Without reopening the browser, right-click any page and check "Save to TabMerger" again.',
        ],
        good: 'The new group shows up in the context menu without needing a restart.',
      },
    ],
  },
  {
    id: 'sign-in-and-sync',
    title: 'Sign-in and sync across devices',
    intro:
      'Beta builds sync through the preview web app at tabmerger-preview.vercel.app, not the main site — sign in there to see your synced groups, dashboard, and sharing.',
    items: [
      {
        steps: [
          'Sign in on two devices or two browser profiles with the beta extension installed on both, pointed at the same account.',
        ],
        example: {
          kind: 'ascii',
          caption: 'What a synced rename should look like a moment later.',
          content: `Device A                        Device B (before sync)
🔵 Research                      🔵 Research
                                 ↓ a few seconds later
Device A                        Device B (after sync)
🔵 Research: ML papers            🔵 Research: ML papers`,
        },
        good: 'Groups created on one device appear on the other within a short time.',
      },
      {
        steps: ['Edit a group name on device A.', 'Check device B without touching anything there.'],
        good: 'Device B picks up the rename without you needing to trigger a manual refresh.',
      },
      {
        steps: ['Delete a group on device A.', 'Confirm it also disappears on device B.'],
        good: 'The deletion propagates instead of the group reappearing ("resurrecting") after sync.',
        report: 'A deleted group comes back on either device after a later sync.',
      },
      {
        steps: ['Go offline (disable network) on one device.', 'Make changes.', 'Reconnect.'],
        good: 'Once back online, changes made offline sync up without duplicating or silently dropping groups.',
      },
    ],
  },
  {
    id: 'encryption',
    title: 'End-to-end encryption passphrase',
    items: [
      {
        steps: ['On first sign-in with sync enabled, set up your encryption passphrase when prompted.'],
        good: 'You\'re prompted once, clearly, before any group data syncs.',
      },
      {
        steps: ['Sign in on a second device.', 'Unlock with the same passphrase.'],
        good: 'The correct passphrase unlocks synced data; an incorrect one is rejected with a clear error and doesn\'t corrupt anything.',
      },
      {
        steps: [
          'In Settings, find "Forgot your passphrase? Reset encryption."',
          'Do NOT use this on data you care about — it permanently discards access to everything encrypted under your current passphrase. Use a throwaway test account if you want to try it.',
          'If you do try it, confirm the reset, then set a brand-new passphrase.',
        ],
        good: 'The warning is clear before you confirm, and after resetting you can set a brand-new passphrase and sync normally again.',
      },
    ],
  },
  {
    id: 'sharing',
    title: 'Sharing',
    items: [
      {
        steps: [
          'Share a group as a link from the extension.',
          'Open that link in a signed-out browser window (or a private/incognito window).',
        ],
        good: 'The shared page loads and shows the group\'s tabs without requiring sign-in.',
      },
      {
        steps: ['Share a group from the web dashboard (tabmerger-preview.vercel.app) instead of the extension.'],
        good: 'Both sharing paths produce a working link with the same content.',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    items: [
      {
        steps: ['Switch between light and dark theme in Settings.', 'Close and reopen the popup.'],
        good: 'The whole UI switches immediately and the choice persists after closing the popup.',
      },
      {
        steps: [
          'In Settings, toggle "Show page images in previews" off.',
          'Hover a tab to see its preview.',
          'Turn the setting back on and hover the same tab again.',
        ],
        example: {
          kind: 'ascii',
          caption: 'The hover preview in both states of the setting.',
          content: `Setting OFF — hover preview:          Setting ON — hover preview:
┌───────────────────────┐            ┌───────────────────────┐
│ GitHub · Change is...  │            │ GitHub · Change is...  │
│ github.com              │            │ github.com              │
│  ┌───────────────────┐ │            │ ┌───────────────────┐ │
│  │      [image icon]  │ │            │ │  [real page image] │ │
│  │      Not enabled   │ │            │ │                     │ │
│  └───────────────────┘ │            │ └───────────────────┘ │
│ Page images are off.   │            │                         │
│ Turn on in Settings.   │            │                         │
└───────────────────────┘            └───────────────────────┘`,
        },
        good: 'Off: the preview clearly says "Not enabled" with a note to turn it on in Settings — the switch itself saves right away, no confirmation dialog. On: a real page image loads in the hover preview.',
        report: 'The preview shows "No preview" (blank) instead of a real image with the setting on and a page that has one.',
      },
      {
        steps: ['If reminders are available in Settings, set one for a minute or two out.', 'Wait for it to fire.'],
        good: 'The reminder notification appears at roughly the time you set.',
      },
    ],
  },
  {
    id: 'import-export',
    title: 'Import and export',
    items: [
      {
        steps: [
          'Export your groups to a JSON file.',
          'Re-import that same file (ideally after clearing data or in a fresh profile).',
        ],
        good: 'All groups, tabs, and structure come back intact.',
      },
      {
        steps: ['If you have one handy, try importing a bookmarks HTML export or a OneTab export.'],
        good: 'Groups and tabs are created from the imported file with reasonable names.',
      },
    ],
  },
]

const WANT_TO_HEAR_ABOUT = [
  'Any data loss — a group, tab, or session that disappeared and shouldn\'t have.',
  'Sync conflicts — the same group ending up different across two devices, or edits from one device getting overwritten unexpectedly.',
  'Anything confusing, unclear, or that took you more clicks than it should have.',
  'Anything slow — the popup opening, search, drag-and-drop, or sync taking noticeably longer than expected.',
]

// lucide-react ships no brand icons, so the GitHub mark (octicon mark-github) is inlined.
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export default function BetaPage() {
  return (
    <div className="container py-16 max-w-5xl">
      {/* Hero */}
      <div className="mb-11 rounded-none bg-accent border border-primary/20 px-8 py-7">
        <p className="text-sm text-muted-foreground mb-2">Beta program</p>
        <h1 className="text-[34px] font-semibold tracking-tight mb-2.5">Help us test TabMerger before it ships</h1>
        <p className="max-w-2xl text-[15.5px] text-text2 leading-relaxed mb-5">
          Get the next version of TabMerger early and tell us what breaks. This page covers joining,
          installing the private beta, what to test, and how to report what you find. AI features are hidden ("coming soon") in this build, so they're not part of
          testing yet. Billing isn't part of this beta, so please don't try to upgrade from the
          beta build.
        </p>
        <Button asChild size="lg">
          <a href={BETA_GOOGLE_GROUP_URL} target="_blank" rel="noreferrer">
            Join the beta
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-12 items-start">
        <LegalToc items={TOC} heading="On this page" />

        <div className="space-y-14 max-w-2xl">
          {/* Join & install */}
          <section id="join" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">1. Join and install</h2>
            <ol className="space-y-4 text-muted-foreground leading-relaxed list-decimal list-inside">
              <li>
                <span className="text-foreground font-medium">Join the tester group.</span>{' '}
                Open{' '}
                <a
                  href={BETA_GOOGLE_GROUP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-foreground transition-colors"
                >
                  groups.google.com/g/tabmerger-beta-testers
                </a>{' '}
                and join. Joining is instant, but make sure you join with the{' '}
                <strong className="text-foreground">same Google account you're signed in to in Chrome</strong> —
                otherwise the private listing won't be visible to you.
              </li>
              <li>
                <span className="text-foreground font-medium">Open the private beta listing.</span>{' '}
                {BETA_STORE_LISTING_URL ? (
                  <a
                    href={BETA_STORE_LISTING_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-foreground transition-colors"
                  >
                    Open the TabMerger BETA listing
                  </a>
                ) : (
                  <span>
                    the "TabMerger BETA" listing on the Chrome Web Store (link coming soon — check
                    the tester group for the current URL in the meantime).
                  </span>
                )}{' '}
                If you see <strong className="text-foreground">"Item not found,"</strong> you likely
                just joined — access can take a little while to appear. Wait a bit and try again
                before assuming something's wrong.
              </li>
              <li>
                <span className="text-foreground font-medium">Install it.</span> Click "Add to
                Chrome." The beta installs as a separate extension ("TabMerger BETA") from the
                stable "TabMerger" listing — you can keep both installed side by side, and their
                data is completely separate. We suggest disabling the stable version while you're
                testing, so you don't accidentally act on the wrong one.
              </li>
              <li>
                <span className="text-foreground font-medium">Sign in through the preview web app.</span>{' '}
                Beta builds sync with{' '}
                <a
                  href="https://tabmerger-preview.vercel.app"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-foreground transition-colors"
                >
                  tabmerger-preview.vercel.app
                </a>{' '}
                — not the main tabmerger site. Sign in there (from the extension or the dashboard
                directly) to see synced groups and sessions.
              </li>
              <li>
                <span className="text-foreground font-medium">Note your version.</span> Open
                TabMerger's Settings and copy the version badge next to the "Settings" title (e.g.{' '}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">v3.1.0-beta.5</code>), or check{' '}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">chrome://extensions</code>{' '}
                and find "TabMerger BETA". Either way, report that real semver — not the Chrome Web
                Store's internal store version number, which is offset and won't match what we use
                to track builds.
              </li>
            </ol>
          </section>

          {/* What to test */}
          <section id="what-to-test" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">2. What to test</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              Work through whichever areas match how you'd normally use TabMerger. Each item below
              has numbered steps, an example of what it should look like, and what a working
              result looks like.
            </p>
            <div className="space-y-3">
              {TEST_AREAS.map((area) => (
                <details key={area.id} id={area.id} className="scroll-mt-24 group rounded-none border">
                  <summary className="cursor-pointer list-none px-4 py-3 font-medium text-sm flex items-center justify-between">
                    <span>{area.title}</span>
                    <span className="text-muted-foreground text-xs group-open:hidden">Show</span>
                    <span className="text-muted-foreground text-xs hidden group-open:inline">Hide</span>
                  </summary>
                  <div className="px-4 pb-4 space-y-5">
                    {area.intro && (
                      <p className="text-muted-foreground text-sm leading-relaxed">{area.intro}</p>
                    )}
                    <ul className="space-y-5">
                      {area.items.map((item, i) => (
                        <li key={i} className="text-sm border-t pt-4 first:border-t-0 first:pt-0">
                          <p className="text-foreground font-medium mb-1.5">Steps</p>
                          <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground mb-3">
                            {item.steps.map((step, si) => (
                              <li key={si}>{step}</li>
                            ))}
                          </ol>
                          {item.example && (
                            <div className="mb-3 max-w-full">
                              {item.example.kind === 'image' ? (
                                <div className="max-w-full overflow-hidden rounded-none border">
                                  <Image
                                    src={item.example.src}
                                    alt={item.example.alt}
                                    width={item.example.width}
                                    height={item.example.height}
                                    loading="lazy"
                                    className="w-full h-auto"
                                  />
                                </div>
                              ) : (
                                <pre className="max-w-full overflow-x-auto rounded-none border bg-muted/50 p-3 text-[11px] leading-relaxed whitespace-pre">
                                  {item.example.content}
                                </pre>
                              )}
                              {item.example.caption && (
                                <p className="mt-1 text-[11px] text-muted-foreground italic">
                                  {item.example.caption}
                                </p>
                              )}
                            </div>
                          )}
                          <p className="text-muted-foreground">
                            <span className="font-medium text-foreground/80">Good looks like: </span>
                            {item.good}
                          </p>
                          {item.report && (
                            <p className="text-muted-foreground mt-1">
                              <span className="font-medium text-foreground/80">Report it if: </span>
                              {item.report}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>
          </section>

          {/* What we especially want to hear about */}
          <section aria-labelledby="want-to-hear-heading">
            <h2 id="want-to-hear-heading" className="text-xl font-semibold mb-4">
              What we especially want to hear about
            </h2>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground text-sm leading-relaxed">
              {WANT_TO_HEAR_ABOUT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          {/* Report bugs */}
          <section id="report-bugs" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">3. Report a bug</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-2">
              Bugs and ideas go to our public GitHub Discussions —{' '}
              <a
                href={GITHUB_DISCUSSIONS_URL}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-foreground transition-colors"
              >
                github.com/{GITHUB_REPO}/discussions
              </a>
              . Take a look there first — someone may have already reported the same thing.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              <strong className="text-foreground">Discussions are public.</strong> Don't paste
              private URLs, tab titles, or screenshots that show personal information — blur or
              crop them first. You'll need a (free) GitHub account to post.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <Button asChild>
                <a href={BUG_REPORT_DISCUSSION_URL} target="_blank" rel="noreferrer">
                  <GitHubMark className="h-4 w-4" />
                  Report a bug on GitHub
                </a>
              </Button>
              <Link
                href="/contact?topic=beta"
                className="text-sm underline underline-offset-4 hover:text-foreground transition-colors text-muted-foreground"
              >
                No GitHub account? Use the contact form.
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <Button asChild variant="outline">
                <a href={IDEA_DISCUSSION_URL} target="_blank" rel="noreferrer">
                  <GitHubMark className="h-4 w-4" />
                  Share an idea on GitHub
                </a>
              </Button>
              <Link
                href="/contact?topic=feedback"
                className="text-sm underline underline-offset-4 hover:text-foreground transition-colors text-muted-foreground"
              >
                No GitHub account? Use the contact form.
              </Link>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed mb-2">
              Both links prefill this template into the discussion body — fill it in before
              posting, it saves us a round trip of follow-up questions:
            </p>
            <pre className="rounded-none border bg-muted/50 p-4 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap">
{BUG_REPORT_TEMPLATE}
            </pre>
          </section>

          {/* FAQ */}
          <section id="faq" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">FAQ</h2>
            <div className="space-y-5 text-sm">
              <div>
                <h3 className="font-medium text-foreground mb-1">I see "Item not found"</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Make sure you joined the Google Group with the same Google account you're signed
                  into in Chrome. Access can take a little while to show up after joining — wait a
                  bit and try again before assuming something's broken.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Can I keep the stable version installed?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Yes — the beta ("TabMerger BETA") is a separate extension from stable
                  ("TabMerger") with completely separate data. You can run both, though we suggest
                  disabling stable while testing to avoid confusing yourself about which one you're
                  using.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Where does my data sync?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Beta builds sync with the preview web app at tabmerger-preview.vercel.app, not
                  the main tabmerger site. Sign in there to see your synced groups, sessions, and
                  sharing.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Where do I see known issues?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Check the repo's{' '}
                  <a
                    href={GITHUB_DISCUSSIONS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-foreground transition-colors"
                  >
                    Discussions Q&A
                  </a>{' '}
                  — that's where beta bug reports live.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">How do I leave the beta?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Leave the{' '}
                  <a
                    href={BETA_GOOGLE_GROUP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-foreground transition-colors"
                  >
                    Google Group
                  </a>{' '}
                  and uninstall the "TabMerger BETA" extension. Your stable installation, if you
                  kept one, is unaffected.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
