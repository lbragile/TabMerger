import type { Metadata } from 'next'
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

const TOC = [
  { id: 'join', label: 'Join & install' },
  { id: 'what-to-test', label: 'What to test' },
  { id: 'report-bugs', label: 'Report a bug' },
  { id: 'faq', label: 'FAQ' },
]

const TEST_AREAS: {
  id: string
  title: string
  intro?: string
  items: { steps: string; good: string }[]
}[] = [
  {
    id: 'groups-and-tabs',
    title: 'Groups and tabs',
    items: [
      {
        steps:
          'Create a group, rename it, and give it a color. Save a few tabs into it, then delete one tab and use the Undo button in the header, then Redo.',
        good: 'The group updates instantly; undo restores the deleted tab exactly where it was; redo removes it again.',
      },
      {
        steps:
          '"Now Open" (the first group) should always mirror your live browser tabs — open and close a few tabs in the browser and watch it update.',
        good: '"Now Open" tracks your real tabs without any manual refresh, and you can\'t delete or reorder it away from the top.',
      },
      {
        steps: 'Save an entire window into a group, then open it back up — as a new window and as tabs in the current window, if both options are offered.',
        good: 'All tabs reopen with the right titles and URLs, in the same order.',
      },
      {
        steps: 'Right-click a saved group and choose Archive, then find it again under the "Archived" section and restore it.',
        good: 'Archived groups disappear from the active list but are never deleted — they reappear exactly as they were once restored.',
      },
      {
        steps: 'Save a session (a named snapshot of your current groups), then restore it later.',
        good: 'Restoring brings the groups back exactly as they were when you saved the session.',
      },
      {
        steps: 'Press Ctrl+K (or Cmd+K) to jump to search, then search by part of a tab title, part of a URL, and letters in order from a title (e.g. "ghub" for GitHub).',
        good: 'Tabs that don\'t match hide as you type, and clearing the search brings everything back.',
      },
      {
        steps:
          'In Settings, set the stale-tab threshold. Tabs saved longer ago than that get an amber dot, and a banner offers Review and Remove stale.',
        good: 'Review shows exactly which tabs are stale, and Remove stale asks for confirmation before deleting anything.',
      },
    ],
  },
  {
    id: 'drag-and-drop',
    title: 'Drag and drop',
    items: [
      {
        steps: 'Drag a single tab from one group into another.',
        good: 'The tab moves cleanly, its favicon/title stay intact, and the source group updates immediately.',
      },
      {
        steps: 'Select multiple tabs (Ctrl/Cmd-click or Shift-click) and drag them together into another group or window.',
        good: 'All selected tabs move together, keeping their relative order.',
      },
      {
        steps: 'Inside a group with several windows, drag a tab from one window card to another.',
        good: 'The tab lands in the target window at the spot you dropped it, and both windows\' tab counts update.',
      },
      {
        steps: 'Drag a tab out of the main panel and drop it directly onto a group in the sidebar.',
        good: 'The tab is added to that group without needing to open the group first.',
      },
      {
        steps: 'Drag a group in the sidebar to reorder it above or below another group.',
        good: 'The new order is remembered after closing and reopening the popup.',
      },
      {
        steps:
          'Try keyboard drag: focus a tab or group, press Space to pick it up, use arrow keys to move it, Space to drop, or Escape to cancel.',
        good: 'You can reorder items with only a keyboard, with a clear announcement of what\'s happening (screen reader or visual cue) at each step.',
      },
    ],
  },
  {
    id: 'right-click-menu',
    title: 'Right-click menu',
    items: [
      {
        steps:
          'On any webpage, right-click and look for "Save to TabMerger" — try saving just the current tab, then try saving to a specific existing group.',
        good: 'The context menu lists your real groups by name and the tab appears in the chosen group right away.',
      },
      {
        steps: 'Create a brand-new group from the popup, then immediately check the right-click menu again without reopening the browser.',
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
        steps:
          'Sign in on two devices or two browser profiles with the beta extension installed on both, pointed at the same account.',
        good: 'Groups created on one device appear on the other within a short time.',
      },
      {
        steps: 'Edit a group name on device A, then check device B without touching anything there.',
        good: 'Device B picks up the rename without you needing to trigger a manual refresh.',
      },
      {
        steps: 'Delete a group on device A and confirm it also disappears on device B.',
        good: 'The deletion propagates instead of the group reappearing ("resurrecting") after sync.',
      },
      {
        steps: 'Go offline (disable network) on one device, make changes, then reconnect.',
        good: 'Once back online, changes made offline sync up without duplicating or silently dropping groups.',
      },
    ],
  },
  {
    id: 'encryption',
    title: 'End-to-end encryption passphrase',
    items: [
      {
        steps: 'On first sign-in with sync enabled, set up your encryption passphrase.',
        good: 'You\'re prompted once, clearly, before any group data syncs.',
      },
      {
        steps: 'Sign in on a second device and unlock with the same passphrase.',
        good: 'The correct passphrase unlocks synced data; an incorrect one is rejected with a clear error and doesn\'t corrupt anything.',
      },
      {
        steps:
          'In Settings, find "Forgot your passphrase? Reset encryption." Do NOT actually use this on data you care about — it is destructive: it permanently discards access to everything encrypted under your current passphrase and starts you fresh. If you want to test it, use a throwaway test account.',
        good: 'The warning is clear before you confirm, and after resetting you can set a brand-new passphrase and sync normally again.',
      },
    ],
  },
  {
    id: 'sharing',
    title: 'Sharing',
    items: [
      {
        steps: 'Share a group as a link from the extension, then open that link in a signed-out browser window.',
        good: 'The shared page loads and shows the group\'s tabs without requiring sign-in.',
      },
      {
        steps: 'Share a group from the web dashboard (tabmerger-preview.vercel.app) instead of the extension.',
        good: 'Both sharing paths produce a working link with the same content.',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    items: [
      {
        steps: 'Switch between light and dark theme.',
        good: 'The whole UI switches immediately and the choice persists after closing the popup.',
      },
      {
        steps:
          'Toggle "Show page images in previews" off, then hover a tab\'s preview — it should say "Not enabled." Turn it on and hover again.',
        good: 'Off: the preview clearly says preview images are not enabled. On: a real page image loads in the hover preview.',
      },
      {
        steps: 'If reminders are available in Settings, set one and confirm it fires.',
        good: 'The reminder notification appears at roughly the time you set.',
      },
    ],
  },
  {
    id: 'import-export',
    title: 'Import and export',
    items: [
      {
        steps: 'Export your groups to a JSON file, then re-import that same file (ideally after clearing or in a fresh profile).',
        good: 'All groups, tabs, and structure come back intact.',
      },
      {
        steps: 'Try importing a bookmarks HTML export or a OneTab export, if you have one handy.',
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
                <span className="text-foreground font-medium">Note your version.</span> Open{' '}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">chrome://extensions</code>{' '}
                and find "TabMerger BETA" — report the version shown there (e.g.{' '}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">3.1.0-beta.5</code>), not the
                Chrome Web Store's internal store version number, which is offset and won't match
                what we use to track builds. If TabMerger's own Settings screen also shows a
                version number, include that too.
              </li>
            </ol>
          </section>

          {/* What to test */}
          <section id="what-to-test" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">2. What to test</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              Work through whichever areas match how you'd normally use TabMerger. Each item below
              has concrete steps and what a working result looks like.
            </p>
            <div className="space-y-3">
              {TEST_AREAS.map((area) => (
                <details key={area.id} id={area.id} className="scroll-mt-24 group rounded-none border">
                  <summary className="cursor-pointer list-none px-4 py-3 font-medium text-sm flex items-center justify-between">
                    <span>{area.title}</span>
                    <span className="text-muted-foreground text-xs group-open:hidden">Show</span>
                    <span className="text-muted-foreground text-xs hidden group-open:inline">Hide</span>
                  </summary>
                  <div className="px-4 pb-4 space-y-4">
                    {area.intro && (
                      <p className="text-muted-foreground text-sm leading-relaxed">{area.intro}</p>
                    )}
                    <ul className="space-y-3">
                      {area.items.map((item, i) => (
                        <li key={i} className="text-sm border-t pt-3 first:border-t-0 first:pt-0">
                          <p className="text-foreground mb-1">
                            <span className="font-medium">Try: </span>
                            {item.steps}
                          </p>
                          <p className="text-muted-foreground">
                            <span className="font-medium text-foreground/80">Good looks like: </span>
                            {item.good}
                          </p>
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
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              Use our contact form to report bugs directly to the team —{' '}
              <Link
                href="/contact?topic=beta"
                className="underline underline-offset-4 hover:text-foreground transition-colors"
              >
                open a beta bug report
              </Link>
              . Have a suggestion instead of a bug?{' '}
              <Link
                href="/contact?topic=feedback"
                className="underline underline-offset-4 hover:text-foreground transition-colors"
              >
                Share feedback and ideas
              </Link>
              .
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed mb-2">
              Copy this template into the message field and fill it in — it saves us a round trip
              of follow-up questions:
            </p>
            <pre className="rounded-none border bg-muted/50 p-4 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap">
{`Summary:
Steps to reproduce:
1.
2.
3.
Expected:
Actual:
Beta version (chrome://extensions "TabMerger BETA"):
Browser and OS:
Signed in: yes / no
Screenshots or screen recording:`}
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
