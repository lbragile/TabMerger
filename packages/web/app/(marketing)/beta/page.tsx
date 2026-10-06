import type { Metadata } from 'next'
import { Fragment } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LegalToc } from '@/components/legal-toc'
import { FREE_TIER_LIMITS, FIREFOX_BETA, CONFLICT_COPY_SUFFIX } from '@tabmerger/shared'
import { KNOWN_ISSUES } from '@/lib/knownIssues'
import { cn } from '@/lib/utils'
import { BetaAreaProgress, BetaChecklistReset, BetaGoodCheck, BetaStepList } from '@/components/beta/BetaChecklist'

// Same gate next.config.ts uses to decide whether to rewrite /firefox-beta/* to the Blob store —
// only set on the Preview deployment (see docs/PUBLISHING.md). Reading it directly here (rather
// than threading a prop) keeps this a plain server component with no client/server split needed
// just for one conditional section.
const FIREFOX_BETA_CONFIGURED = Boolean(process.env.FIREFOX_BETA_BLOB_BASE_URL)
const FIREFOX_BETA_XPI_URL = `${FIREFOX_BETA.PATH}/${FIREFOX_BETA.LATEST_XPI_FILE}`

export const metadata: Metadata = {
  title: 'Beta Program',
  description:
    'Join the TabMerger beta — install the private beta build, know what to test, and report bugs directly to the team.',
}

// The Google Group is also the Chrome Web Store trusted-tester list for the private
// BETA item. Joining it is what makes the private listing visible to that Google
// account (access can take a little while to appear after joining).
const BETA_GOOGLE_GROUP_URL = 'https://groups.google.com/g/tabmerger-beta-testers'

// The private BETA item's store listing. It only opens for members of the tester group
// (the Chrome Web Store shows "Item not found" to everyone else).
const BETA_STORE_LISTING_URL = 'https://chromewebstore.google.com/detail/tabmerger-beta/nboljhidpjakiohfdkdjkcljdehcapcd'

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
  { id: 'known-issues', label: 'Known issues' },
  { id: 'report-bugs', label: 'Report a bug' },
  { id: 'faq', label: 'FAQ' },
]

type Example =
  | { kind: 'image'; src: string; width: number; height: number; alt: string; caption?: string }
  | { kind: 'ascii'; content: string; caption?: string }
  | { kind: 'testCards'; caption?: string }

const toExamples = (example: Example | Example[] | undefined): Example[] =>
  example === undefined ? [] : Array.isArray(example) ? example : [example]

// Stripe's published test cards (https://docs.stripe.com/testing). Test mode only:
// a real card is rejected, and none of these ever move money.
const STRIPE_TEST_CARDS: { label: string; number: string; note?: string }[] = [
  { label: 'Successful payment (Visa)', number: '4242 4242 4242 4242', note: 'Use this one to upgrade' },
  { label: 'Generic decline', number: '4000 0000 0000 0002' },
  { label: 'Insufficient funds', number: '4000 0000 0000 9995' },
  { label: 'Needs 3D Secure authentication', number: '4000 0025 0000 3155' },
]

type TestItem = {
  // Required title above this item's steps, naming the feature (e.g. "Cancelling").
  heading: string
  // Required one-liner under the title: what this item checks, in plain words ("That cancelling
  // keeps Pro until…"), so testers understand the point of the steps before doing them.
  checks: string
  steps: string[]
  // One example, or several shown in order (e.g. the pricing-page button, then Stripe's page).
  example?: Example | Example[]
  // "Good looks like": one entry per outcome a tester can confirm, each with its own checkbox.
  // Keep an explanation or caveat in the same entry as the outcome it qualifies.
  good: string[]
  report?: string
  // Needs a Pro account: `true` for the whole item, or a note saying which part (e.g. "Only the
  // Cloud sync switch needs Pro"). Mirror what the server enforces (sync, sharing, encryption).
  pro?: true | string
}

/**
 * "Pro" / "Partly Pro" chip on test items, and "Pro" / "Some Pro" on their area's header. The
 * visible word is the whole accessible text (no hidden extra words: they got copied along with
 * the sentence around them); the explanation is in the legend above the areas and in `title`.
 */
function ProBadge({ partial, scope = 'item' }: { partial: boolean; scope?: 'item' | 'area' }) {
  const label = partial ? (scope === 'area' ? 'Some Pro' : 'Partly Pro') : 'Pro'
  const title = partial
    ? scope === 'area'
      ? 'Some items here need a Pro account'
      : 'Part of this item needs a Pro account'
    : scope === 'area'
      ? 'Every item here needs a Pro account'
      : 'Needs a Pro account'
  return (
    <span
      title={title}
      className={cn(
        'inline-block rounded-none px-1.5 py-px align-middle text-[0.6875rem] font-semibold normal-case tracking-normal',
        partial ? 'border border-primary text-primary' : 'bg-primary text-primary-foreground'
      )}
    >
      {label}
    </span>
  )
}

type AreaAccess = 'free' | 'upgrading' | 'some-pro' | 'pro'

/** Which group a test area is listed under; TEST_AREAS is ordered free → upgrading → some Pro → Pro. */
function areaAccess(area: { id: string; items: TestItem[] }): AreaAccess {
  if (area.id === 'upgrading-to-pro') return 'upgrading'
  if (area.items.every((item) => item.pro === true)) return 'pro'
  return area.items.some((item) => item.pro) ? 'some-pro' : 'free'
}

const AREA_ACCESS_LABELS: Record<AreaAccess, string> = {
  free: 'Free: no account needed',
  upgrading: 'Getting Pro: test payments, no real money',
  'some-pro': 'Free and Pro: each Pro part is marked',
  pro: 'Pro only',
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
        heading: 'Groups, colors, and undo/redo',
        checks: 'That you can create, name and color a group, save tabs into it, and undo or redo a change without losing anything.',
        steps: [
          'Click "Add Group" in the sidebar and give it a name.',
          'Click the colored dot next to the group to open the color picker, pick a preset or drag to any color, then click Apply.',
          'Save a few tabs into the group (drag them in, or use the right-click menu).',
          'Delete one tab, then click the Undo button (header, top right) and then Redo.',
        ],
        example: {
          kind: 'image',
          src: '/beta/color-new-group.webp',
          width: 1600,
          height: 1200,
          alt: 'TabMerger popup with a new group selected and its color picker open: a saturation and hue picker, 12 preset colors, a hex field, and Cancel and Apply buttons',
          caption: 'Clicking a group\'s color dot opens this picker.',
        },
        good: [
          'The group updates instantly.',
          'Undo restores the deleted tab exactly where it was.',
          'Redo removes it again.',
          'With sync on, Undo can turn grey after a sync brings in changes from another device. That is expected, not a bug: the undo history is cleared when changes arrive from elsewhere.',
        ],
      },
      {
        heading: '"Now Open" follows your open tabs',
        checks: 'That the permanent "Now Open" group always mirrors the tabs actually open in your browser.',
        steps: [
          'Open the popup and look at "Now Open" — it\'s always the first group in the sidebar.',
          'Open and close a few browser tabs without touching the popup.',
          'Reopen the popup and check "Now Open" again.',
        ],
        example: {
          kind: 'image',
          src: '/beta/now-open.webp',
          width: 1600,
          height: 1200,
          alt: 'The popup with "Now Open" selected: one window listing the three tabs currently open in the browser',
          caption: '"Now Open" is always first in the sidebar and lists the tabs open right now.',
        },
        good: [
          '"Now Open" tracks your real tabs without any manual refresh.',
          'You can\'t delete or reorder it away from the top.',
        ],
      },
      {
        heading: 'Saving and reopening whole windows',
        checks: 'That a saved window keeps every tab, in order, and reopens intact.',
        steps: [
          'Save an entire window into a group (drag the window\'s drag-handle onto a group, or use its "…" menu).',
          'Open the group and use the window\'s "…" menu to reopen it — as a new window, and as tabs in the current window, if both options are offered.',
        ],
        example: {
          kind: 'image',
          src: '/beta/multi-window.webp',
          width: 1600,
          height: 1200,
          alt: 'A TabMerger group with four separate saved windows, each holding one tab',
          caption: 'A group can hold several separate windows — each with its own tab count.',
        },
        good: [
          'All tabs reopen with the right titles and URLs, in the same order.',
        ],
      },
      {
        heading: 'Archiving and restoring a group',
        checks: 'That archiving hides a group without deleting it, and restoring brings it back unchanged.',
        steps: [
          'Right-click a saved group in the sidebar and choose Archive.',
          'Open the "Archived" section at the bottom of the sidebar and find it.',
          'Restore it from there.',
        ],
        example: {
          kind: 'image',
          src: '/beta/archive-section.webp',
          width: 1600,
          height: 1200,
          alt: 'The Archived section at the bottom of the TabMerger sidebar, expanded to show an archived group',
          caption: 'The Archived section at the bottom of the sidebar, opened: "Shopping" is archived, with Restore and Delete buttons.',
        },
        good: [
          'Archived groups disappear from the active list but are never deleted.',
          'They reappear exactly as they were once restored.',
        ],
      },
      {
        heading: 'Saving and restoring sessions',
        checks: 'That a saved session brings your groups back exactly as they were when you saved it.',
        steps: [
          'Save a session — a named snapshot of your current groups (look for "Save Session" near the sidebar\'s Sessions area).',
          'Make some changes to your groups.',
          'Restore the saved session.',
        ],
        example: {
          kind: 'image',
          src: '/beta/sessions-section.webp',
          width: 1600,
          height: 1200,
          alt: 'The Sessions section of the TabMerger sidebar, showing a saved session',
          caption: 'A saved session in the Sessions section, with Restore and Delete buttons, and the "Session saved" notification.',
        },
        good: [
          'Restoring brings the groups back exactly as they were when you saved the session.',
        ],
      },
      {
        heading: 'Search',
        checks: 'That search finds tabs by title or URL across all your groups, and that the group:, window: and tag: filters narrow it down.',
        steps: [
          'Press Ctrl+K (Cmd+K on Mac) to open search.',
          'Type a plain substring, like "hub", with a "GitHub" tab saved somewhere — it matches title or URL, case-insensitive.',
          'Clear that and try a prefix instead: type "group:" and pick one of your groups from the picker that appears, or type e.g. "window:" or "tag:" the same way.',
          'Click one of the results.',
        ],
        example: {
          kind: 'image',
          src: '/beta/search-filter.webp',
          width: 1600,
          height: 1200,
          alt: 'The TabMerger search overlay with "hub" typed, showing a matching GitHub tab result',
          caption: 'Typing "hub" — a plain substring match against tab title or URL.',
        },
        good: [
          'Results update as you type.',
          'A plain search matches any tab whose title or URL contains that substring anywhere (not letters-in-order).',
          'A "group:", "window:" or "tag:" prefix scopes the search and offers a picker for that prefix.',
          'Clicking any result closes search and jumps you straight to that result\'s group (and window, for a window result).',
        ],
      },
      {
        heading: 'Stale tabs',
        checks: 'That tabs you haven\'t opened for a while get flagged, and can be reviewed and removed safely.',
        steps: [
          'Open Settings and set the stale-tab threshold (e.g. 30 days).',
          'Wait for (or seed) at least 5 tabs older than that threshold.',
          'Look for the amber banner above the tab list and try both of its buttons: Review, then Remove stale.',
        ],
        example: {
          kind: 'image',
          src: '/beta/stale-tabs-banner.webp',
          width: 1600,
          height: 1200,
          alt: 'The amber stale-tab banner above the tab list, with Review and Remove stale buttons',
          caption: 'The stale-tab banner and its Review / Remove stale buttons.',
        },
        good: [
          'Review shows exactly which tabs are stale.',
          'Remove stale asks for confirmation before deleting anything (if "confirm before delete" is on in Settings).',
        ],
        report: 'A group you deleted or archived reappears on its own — that\'s the "resurrection" bug we\'re specifically hunting.',
      },
      {
        heading: 'Setting up tab reminders',
        checks: 'That you can set, change and clear a reminder on a saved tab, and that it notifies you at the time you chose.',
        steps: [
          'Right-click a saved tab and choose "Remind me…". Reminders are per tab; there\'s no Settings control for them.',
          'In the editor that opens under the tab, click a preset (30 min, 1 hour, 3 hours or Tomorrow) to set it straight away.',
          'Open it again ("Edit reminder" in the right-click menu, or click the tab\'s clock icon). This time pick a date and time a couple of minutes out, type a short note, and click Set.',
          'Hover the clock icon, then wait for the reminder to fire and click its notification.',
          'Set another one, then right-click the tab and choose "Clear reminder".',
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/tab-reminder.webp',
            width: 1600,
            height: 1200,
            alt: 'A saved tab\'s "Remind me in…" editor: 30 min, 1 hour, 3 hours and Tomorrow buttons, a date and time field, an optional note, and Cancel and Set',
            caption: 'Right-click a saved tab → "Remind me…" opens this editor under the tab.',
          },
          {
            kind: 'image',
            src: '/beta/tab-reminder-set.webp',
            width: 1600,
            height: 1200,
            alt: 'The same window after setting a reminder: a clock icon at the end of the Q3 Planning tab\'s row',
            caption: 'Once set, the tab shows a clock icon.',
          },
        ],
        good: [
          'The tab shows a clock icon once a reminder is set, and hovering it shows the time (and your note).',
          'The right-click menu now offers "Edit reminder" and "Clear reminder" for it.',
          'Set is ignored for a time in the past; only a future time sets the reminder.',
          'A "TabMerger Reminder" notification with the tab\'s title (and your note) appears at roughly the time you set, and stays until you act on it.',
          'Clicking the notification opens the tab.',
          'Clear reminder removes the clock icon, and no notification appears later.',
        ],
        report: 'A reminder never fires, fires twice, or still fires after you cleared it.',
      },
      {
        heading: 'Notes on groups, windows and tabs',
        checks: 'That you can attach a short note to a group, a window or a tab, and edit it later.',
        steps: [
          'Group: right-click a group in the sidebar (or use the ⋯ button above its windows) and choose "Add note". Type something and click Save.',
          'Window: right-click a window\'s header (or use its ⋯ button) and choose "Add note". This time save with Ctrl+Enter (Cmd+Enter on Mac).',
          'Tab: right-click a saved tab and choose "Add note". Type something, then click somewhere else instead of Save.',
          'Click a note icon to reopen the note, change it, and press Escape.',
          'Close and reopen the popup.',
        ],
        good: [
          'Each saved note shows a small note icon: next to the group\'s window count, in the window\'s header, and on the tab\'s row. The menu item now says "Edit note".',
          'Save, Ctrl/Cmd+Enter and clicking away all save the note; Escape and Cancel close it without saving.',
          'Notes are limited to 500 characters, with a counter under the box.',
          'Notes are still there after reopening the popup (and, with sync on, on your other devices).',
        ],
        report: 'A note is lost, attached to the wrong item, or saved when you pressed Escape or Cancel.',
      },
      {
        heading: 'Deleting, with and without "Confirm before deleting"',
        checks: 'That deletions ask first only when "Confirm before deleting" is on, and that Undo brings back what you deleted.',
        steps: [
          'In Settings → General, make sure "Confirm before deleting" is off (it\'s off by default) and save.',
          'Remove a tab (its ✕, or right-click → Remove tab), remove a window (its ⋯ → Remove window), and delete a group (right-click it → Delete group). After each one, click Undo (top right).',
          'Turn "Confirm before deleting" on, save, and repeat the three deletions. Cancel the first dialog you get, then confirm the next.',
          'With it on, also try deleting several selected groups from the selection bar, and "Remove stale" on a group with stale tabs.',
        ],
        good: [
          'With the setting off, windows and groups are removed straight away, with no dialog.',
          'With it on, removing a window, deleting a group, deleting a selection and "Remove stale" each ask first, and Cancel leaves everything as it was.',
          'Removing a single tab never asks, with the setting on or off. Undo brings it back.',
          'Undo restores whatever you just deleted: the tab, window or group, in the same place, with its tabs.',
        ],
        report: 'Something is deleted without asking while the setting is on (other than a single tab), a dialog appears while it\'s off, or Undo doesn\'t bring the item back exactly.',
      },
      {
        heading: 'The group menu',
        checks: 'That every action in a group\'s menu does what its label says.',
        steps: [
          'Right-click a saved group in the sidebar to open its full menu. The ⋯ button above a group\'s windows opens a shorter version of it.',
          'Try Rename, Add note and Duplicate.',
          'Try Replace with current (swaps the group\'s windows for your open browser windows) and Merge with current (adds your open windows to the group). Undo after each.',
          'Try Open all in new window, Unite windows, Split windows, Sort by title, Sort by URL and Deduplicate tabs.',
          'Try Archive group, then Restore group from the Archived section.',
          'Right-click "Now Open" too: it has no Rename, Replace, Merge, Archive or Delete.',
        ],
        good: [
          'Each action does what its description says, on that group only.',
          'Duplicate makes a copy with all its tabs; Unite leaves one window holding every tab, and Split gives each tab its own window.',
          'Sort by title / URL orders every tab alphabetically, and Deduplicate removes tabs with the same URL.',
          'Changes can be undone with Undo.',
        ],
        report: 'An action affects the wrong group, loses tabs, or can\'t be undone.',
      },
      {
        heading: 'The window menus',
        checks: 'That both of a window\'s menus work: right-clicking its header, and its ⋯ button.',
        steps: [
          'Right-click a window\'s header: try "Move to group" (pick another group, or create a new one from the list), Add note and Rename window.',
          'Open the window\'s ⋯ button: try Rename, Mark incognito (then Remove incognito), Open in browser, and Sort this window by title / by URL.',
          'Right-click a window in "Now Open": the first item reads "Copy to group", and removing it reads "Close window".',
        ],
        good: [
          'Move to group moves the whole window, with its tabs, into the chosen group; a new group created from the menu gets the window.',
          'Mark incognito adds an "Incognito" label to the window, and Remove incognito takes it away.',
          'Open in browser opens the window\'s tabs in a new browser window; if some of them are already open, only the missing ones are added to that window.',
          'Sorting only reorders that window\'s tabs.',
          'From "Now Open", Copy to group saves a copy and leaves your real window open.',
        ],
        report: 'A menu action changes a different window, or Close window in "Now Open" closes the wrong browser window.',
      },
      {
        heading: 'The tab menu',
        checks: 'That right-clicking a tab offers the right actions for it.',
        steps: [
          'Right-click a saved tab: try "Move to group", Rename tab, then "Reset to original title".',
          'Right-click a tab in "Now Open": "Copy to group" replaces "Move to group", and removing it reads "Close tab".',
          'If you have a URL rule that matches an open tab, right-click that tab in "Now Open" and look for "Auto-save to …".',
        ],
        good: [
          'Move to group moves the tab into the chosen group; Copy to group (from "Now Open") saves a copy and leaves the real tab open.',
          'Rename tab shows your title with a small "renamed" tag, and Reset to original title brings back the page\'s own title.',
          '"Auto-save to <group>" appears only for a tab whose address matches one of your URL rules, and saves it to that rule\'s group.',
        ],
      },
    ],
  },
  {
    id: 'right-click-menu',
    title: 'Right-click menu',
    items: [
      {
        heading: 'Saving from the right-click menu',
        checks: 'That right-clicking any web page lets you save the tab to TabMerger, or straight into a chosen group.',
        steps: [
          'On any webpage, right-click and open "Save to TabMerger".',
          'Try "Save this tab" first, then try saving to a specific existing group.',
        ],
        example: {
          kind: 'image',
          src: '/beta/context-menu.webp',
          width: 1600,
          height: 1200,
          alt: 'Illustration of the right-click menu on a web page: "Save to TabMerger" opens Save this tab, Save tabs to the left, Save tabs to the right and Save all other tabs; "Save this tab" lists the groups Work (1w · 5t), Research (1w · 4t), Shopping (1w · 3t) and Reading List (1w · 5t), each with its color',
          caption: 'Illustration (the browser draws this menu itself, so it can\'t be screenshotted): each of the four "Save…" options lists your groups with their color, window count and tab count.',
        },
        good: [
          'The context menu lists your real groups by name.',
          'The tab appears in the chosen group right away.',
        ],
      },
      {
        heading: 'New groups appear in the right-click menu',
        checks: 'That the right-click menu picks up new groups without restarting the browser.',
        steps: [
          'Create a brand-new group from the popup.',
          'Without reopening the browser, right-click any page and check "Save to TabMerger" again.',
        ],
        example: {
          kind: 'image',
          src: '/beta/context-menu-new-group.webp',
          width: 1600,
          height: 1200,
          alt: 'Illustration of the same right-click menu with a fifth group, "Trip planning (0w · 0t)", at the end of the group list',
          caption: 'Illustration: a new, still-empty group ("Trip planning") appears at the end of the list.',
        },
        good: [
          'The new group shows up in the context menu without needing a restart.',
        ],
      },
    ],
  },
  {
    id: 'upgrading-to-pro',
    title: 'Upgrading to Pro (test payments)',
    intro:
      'Billing is part of this beta, but only with Stripe\'s test cards — no real card will work and no real money changes hands. Pro AI and AI credit packs are still "coming soon" and are not purchasable, so this is Pro (unlimited groups/tabs + sync) only.',
    items: [
      {
        heading: 'Test card warning',
        checks: 'That you only ever use Stripe\'s test cards: nothing in this beta charges real money.',
        steps: ['Read this before starting checkout — the card details you need are below.'],
        example: {
          kind: 'testCards',
        },
        good: [
          'You never type a real card number into this flow.',
        ],
      },
      {
        heading: 'Upgrading from the extension',
        checks: 'That upgrading from inside the extension works end to end, and the extension then shows Pro.',
        steps: [
          'Open the extension popup and use any "Upgrade to Pro" entry point — the header\'s upgrade button, the nag banner that appears as you approach the free limit, or an upgrade prompt shown when you hit a free-tier limit.',
          'This opens the beta web app\'s pricing page (tabmerger-preview.vercel.app/pricing) in a new browser tab. Sign in there with the same account you use in the extension.',
          'Choose the Pro plan, monthly or yearly, and continue to Stripe Checkout.',
          'Complete checkout with the test card above (or a decline/3D-Secure card, if you\'re testing that path), then return to the app.',
        ],
        good: [
          'Checkout completes and you land back in the web app with Pro shown.',
          'The extension\'s popup polls for your plan roughly every 30 seconds, so it should pick up Pro on its own shortly — reopening the popup also forces a fresh check if you don\'t want to wait.',
        ],
        report: `The extension still shows free-tier limits (${FREE_TIER_LIMITS.groups} groups / ${FREE_TIER_LIMITS.tabs} tabs / ${FREE_TIER_LIMITS.urlRules} URL rules) more than a couple of minutes after a successful checkout and a popup reopen.`,
      },
      {
        heading: 'Upgrading from the web account page',
        checks: 'That upgrading from the website\'s account page works, and the website and extension agree on your plan.',
        steps: [
          'Instead of going through the extension, sign in directly at tabmerger-preview.vercel.app and open Account settings.',
          'Under "Subscription," click "Upgrade" and complete checkout with the test card.',
        ],
        example: {
          kind: 'image',
          src: '/beta/account-upgrade.webp',
          width: 1600,
          height: 1200,
          alt: 'Account settings on a free account: the Subscription card shows Current plan Free with an Upgrade button',
          caption: 'Before upgrading: Free, with an Upgrade button. Afterwards it shows Pro and "Manage billing" (see "Account page" below).',
        },
        good: [
          'The Subscription card on the account page now shows Pro, with a "Manage billing" button in place of "Upgrade."',
          'The extension picks up the same Pro status (see the polling note above) — the web account page and the extension should never disagree about your plan.',
        ],
        report: 'The web account page and the extension popup show different plans (one says Pro, the other still says Free) more than a couple of minutes apart.',
      },
      {
        heading: 'Paying in your local currency',
        checks: 'That checkout shows, and charges, the price in your own currency.',
        steps: [
          'Prices on the site are in US dollars (the pricing page says so under the plans; the account page, dashboard and extension Settings write them as "US$"). Outside the US, checkout offers your local currency.',
          'Start a checkout from your real location, or simulate another country: sign up a NEW account with your email plus "+location_" and a two-letter country code, e.g. yourname+location_FR@gmail.com for France (Gmail delivers "+anything" addresses to your normal inbox). A VPN in another country works too.',
          'Look at the price on Stripe\'s checkout page, then complete it with the test card in that currency.',
        ],
        example: {
          kind: 'image',
          src: '/beta/checkout-local-currency.webp',
          width: 1600,
          height: 1200,
          alt: 'Stripe checkout for TabMerger Pro showing €3.66 per month, with EUR selected and a USD alternative, and the line "1 USD = 0.9171 EUR. Charges will vary based on exchange rates."',
          caption: 'Checkout for a France (+location_FR) address: euros by default, US dollars one click away. Exchange rates change, so your amount will differ.',
        },
        good: [
          'Checkout shows the price in your local currency (for example €3.66 in France or CA$5.89 in Canada for the US$3.99 plan), with a switch to pay in US dollars instead and a line showing the exchange rate and its conversion fee. In the US it simply shows US$3.99.',
          'After paying, the plan works exactly as with US dollars.',
        ],
        report: 'Outside the US, checkout offers only US dollars, the amount charged differs from what checkout showed, or paying in a local currency doesn\'t give you Pro.',
      },
      {
        heading: 'Switching between monthly and yearly',
        checks: 'That a Pro subscription can move between monthly and yearly billing, and is charged correctly for it.',
        pro: true,
        steps: [
          'With an active Pro subscription, open the pricing page. Your plan\'s card says how you\'re billed ("Billed monthly") and has a "Switch to yearly billing" button (or "Switch to monthly billing" if you pay yearly).',
          'Monthly → yearly: click the switch button and confirm on Stripe\'s page.',
          'Yearly → monthly: do the same, then try the button a second time.',
          'Also open "Manage billing" on the account page: its "Update subscription" option shows the same monthly/yearly choice.',
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/pricing-switch.webp',
            width: 1600,
            height: 1200,
            alt: 'The pricing page while on Pro monthly: the Pro card is marked Current, says "Billed monthly", and has a "Switch to yearly billing" button',
            caption: 'On the pricing page, your plan\'s card shows how you\'re billed and the switch button.',
          },
          {
            kind: 'image',
            src: '/beta/portal-switch.webp',
            width: 1600,
            height: 1200,
            alt: 'Stripe\'s "Update your subscription" page with Monthly and Yearly tabs, showing the current TabMerger Pro plan at US$3.99 per month',
            caption: 'The same choice in Manage billing → Update subscription (Stripe\'s page).',
          },
        ],
        good: [
          'Monthly → yearly applies straight away: Stripe shows and charges the yearly price minus what\'s left of your month.',
          'After switching to yearly, the account page shows the yearly price (US$42.99/yr) within about a minute.',
          'Yearly → monthly waits for the end of your paid year, so nothing is charged now.',
          'Pressing the button again explains that a change is already scheduled.',
          'Only Pro monthly and yearly are offered, never a different plan.',
        ],
        report: 'A switch charges the wrong amount, the account page still shows the old billing period more than a couple of minutes later, yearly → monthly charges you immediately, or you\'re offered a plan other than Pro.',
      },
      {
        heading: 'Cancelling',
        checks: 'That cancelling keeps Pro until the end of the period you paid for, then returns you to Free.',
        pro: true,
        steps: [
          'On the account page, with an active Pro subscription, click "Manage billing" to open Stripe\'s billing portal.',
          'Cancel the subscription from there and return to TabMerger.',
        ],
        example: {
          kind: 'image',
          src: '/beta/portal-cancel.webp',
          width: 1600,
          height: 1200,
          alt: 'Stripe\'s "Cancel your subscription" dialog for TabMerger Pro at US$3.99 per month, with an optional reason and Go back and Continue to cancellation buttons',
          caption: 'Stripe asks for an optional reason before cancelling.',
        },
        good: [
          'You keep Pro access until the end of the current billing period — cancelling doesn\'t immediately drop you to Free.',
          'After that period ends, the account page and extension should both show Free again.',
        ],
        report: 'Cancelling drops you to Free immediately instead of at period end, or the plan never reverts to Free after the period actually ends.',
      },
    ],
  },
  {
    id: 'drag-and-drop',
    title: 'Drag and drop',
    intro:
      'This area covers every drag interaction in the popup — sorting, moving between windows and groups, multi-item drags, the two "drop for a new..." zones, cancelling, keyboard-only dragging, and whether the result sticks. Work through as many of these as you can; this is the single area we\'re most focused on for this beta.',
    items: [
      // --- Sorting ---
      {
        heading: 'Sorting: tabs within a window',
        checks: 'That dragging a tab reorders it within its window, landing exactly where you drop it.',
        steps: [
          'Drag a tab down within the same window to move it later in the list, then drag it back up to its original spot.',
          'Drag a tab all the way to the first position in the window, then all the way to the last.',
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-sort-tabs.webp',
          width: 1600,
          height: 1200,
          alt: 'A tab being dragged within its window card: the dragged row floats with a highlighted border above the gap where it will land',
          caption: 'Mid-drag: the tab floats and the others make room where it will drop.',
        },
        good: [
          'The tab lands exactly where you dropped it, and the rest of the list shifts to make room.',
          'No other tab moves or duplicates.',
        ],
      },
      {
        heading: 'Sorting: windows within a group',
        checks: 'That window cards can be reordered inside a group.',
        steps: ['In a group with two or more saved windows, drag a window card above or below another one.'],
        example: {
          kind: 'image',
          src: '/beta/drag-sort-windows.webp',
          width: 1600,
          height: 1200,
          alt: 'A window card being dragged between two other window cards in a group with four windows',
          caption: 'Dragging a whole window card by its handle to reorder it within the group.',
        },
        good: [
          'The window cards swap order and the new order is what you see immediately — no flicker back to the old order.',
        ],
      },
      {
        heading: 'Sorting: groups in the sidebar',
        checks: 'That groups reorder freely in the sidebar while "Now Open" stays first.',
        steps: [
          'Drag a group in the sidebar up or down to reorder it above or below another group.',
          'Try dragging a group above "Now Open" (the first row in the sidebar).',
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-reorder-group.webp',
          width: 1600,
          height: 1200,
          alt: 'A group row being dragged to a new position in the TabMerger sidebar',
          caption: 'Reordering a group in the sidebar.',
        },
        good: [
          '"Now Open" always stays pinned as the first row — you cannot drop a group above it, drag it, delete it, or reorder it away from the top.',
          'Every other group reorders freely.',
        ],
        report: 'Anything lands above "Now Open", or "Now Open" itself becomes draggable.',
      },

      // --- Cross-window ---
      {
        heading: 'Cross-window: moving a tab between window cards',
        checks: 'That a tab can move from one window card to another, at the exact spot you drop it.',
        steps: [
          'Inside a group with several windows, drag a tab from one window card onto another window card.',
          'This time, drop it between two existing tabs in the destination window rather than at the top or bottom.',
        ],
        example: {
          kind: 'image',
          src: '/beta/cross-window-tab-drag.webp',
          width: 1600,
          height: 1200,
          alt: 'A tab being dragged from one saved window to another inside the same TabMerger group',
          caption: 'Dropping a tab onto another window inside the same group.',
        },
        good: [
          'The tab lands exactly at the position you dropped it (not just appended to the end).',
          'Both windows\' tab counts update immediately.',
        ],
      },

      // --- Cross-group ---
      {
        heading: 'Cross-group: dropping a tab onto a sidebar group',
        checks: 'That dropping a tab on a group in the sidebar moves it into that group without opening the group first.',
        steps: [
          'Drag a tab out of the main panel and drop it directly onto a group in the sidebar — try this on a group that\'s currently open (active) and one that isn\'t.',
          'Try it once more, but pause with the tab held over a different (non-active) sidebar group for about a second before releasing.',
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-single-tab-to-group.webp',
          width: 1600,
          height: 1200,
          alt: 'A single tab being dragged onto a group row in the TabMerger sidebar',
          caption: 'Dropping a tab directly onto a sidebar group.',
        },
        good: [
          'The tab is added to that group as a new window without needing to open the group first.',
          'If you paused over a non-active group, it should open ("spring open") after about half a second so you can see it land — and land correctly, not on the wrong window.',
        ],
        report: 'The group springs open but the tab lands in the wrong window, or on top of an existing tab instead of as its own new window.',
      },
      {
        heading: 'Cross-group: dragging a whole window into another group',
        checks: 'That a whole window, with all its tabs, can move into another group.',
        steps: ['Drag an entire window card (using its own drag handle, not a single tab inside it) onto a different group in the sidebar.'],
        example: {
          kind: 'image',
          src: '/beta/drag-window-to-group.webp',
          width: 1600,
          height: 1200,
          alt: 'A window card dragged onto the sidebar, over the Shopping group, which is highlighted and opened in the main panel',
          caption: 'Dragging a window onto a sidebar group. The group under the pointer gets a colored edge and opens behind the card.',
        },
        good: [
          'The whole window — with all its tabs — becomes a new window in the destination group.',
          'This works even if it\'s the last window left in the source group.',
        ],
        report: 'The source group or its emptied window disappears instead of staying (an empty window/group should stick around, not vanish).',
      },

      // --- Multi-item ---
      {
        heading: 'Multi-item: selecting and dragging several tabs',
        checks: 'That several selected tabs drag together as one block, keeping their order.',
        steps: [
          'Ctrl-click (Cmd-click on Mac) two or three non-adjacent tabs to select them.',
          'Shift-click to select a contiguous range of tabs instead.',
          'With several tabs selected, drag them together to a new position in the same window.',
        ],
        example: {
          kind: 'image',
          src: '/beta/multi-select-tabs.webp',
          width: 1600,
          height: 1200,
          alt: 'Several tabs selected together in the TabMerger popup, shown with checkboxes',
          caption: 'Two tabs checked in selection mode; the bar at the bottom counts them.',
        },
        good: [
          'All selected tabs move together as one block, keeping their relative order — the block lands at the gap, not scattered or in click order.',
        ],
      },
      {
        heading: 'Multi-item: dragging a selection across windows and groups',
        checks: 'That a multi-tab selection keeps its order when dragged into another window or group.',
        steps: [
          'Select several tabs again, then drag them across to a different window in the same group.',
          'Repeat once more, but drag the selection onto a different group in the sidebar this time.',
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-multiselect.webp',
          width: 1600,
          height: 1200,
          alt: 'A multi-tab selection mid-drag in the TabMerger popup',
          caption: 'Dragging a multi-tab selection.',
        },
        good: [
          'The whole selection moves together in both cases, landing in the same relative order it started in.',
        ],
      },
      {
        heading: 'Multi-item: select all and multi-group drag',
        checks: 'That select-all works within a window, and that several selected groups can be dragged together.',
        steps: [
          'Focus a window\'s tab list and press Ctrl+A (Cmd+A on Mac) to select every tab in that window, if your window has more than one tab.',
          'In the sidebar, Ctrl-click two or three groups to select them, then drag that selection by one of their grips to reorder them together.',
        ],
        example: {
          kind: 'image',
          src: '/beta/multi-group-drag.webp',
          width: 1600,
          height: 1200,
          alt: 'Selection mode with three groups selected; dragging one of them carries the others along, with a count badge on the dragged row and "3 groups selected" in the bottom bar',
          caption: 'Three selected groups dragged together in the sidebar. The bar at the bottom counts the selection.',
        },
        good: [
          'Ctrl/Cmd+A selects every tab in the focused window (skipping any that are hidden by a search filter).',
          'The multi-group drag moves the selected groups together as one block.',
          'The block never lands above "Now Open".',
        ],
        // TODO(screenshot): a multi-group sidebar selection mid-drag, once the demo agent has one.
      },

      // --- Drop zones ---
      {
        heading: 'Drop zones: "Drop here for a new window" and "Drop for a new group"',
        checks: 'That dropping on these zones creates a new window or a new group from what you dragged.',
        steps: [
          'Drag a tab (or a selection of tabs) toward the bottom of a group\'s window list, where the "Drop here for a new window" zone appears, and drop there.',
          'Drag a tab toward the bottom of the sidebar, where the "Drop for a new group" zone appears, and drop there.',
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-drop-zones.webp',
          width: 1600,
          height: 1200,
          alt: 'A tab dragged over the highlighted "Drop here for a new window" zone under the window list, with the "Drop for a new group" zone visible in the sidebar',
          caption: 'While you drag, both drop zones appear. The one under the pointer is highlighted.',
        },
        good: [
          'Each drop creates a brand-new window or group holding exactly the dragged item(s), in their original relative order.',
        ],
        report: 'The "Drop for a new group" zone still appears once you\'re already at your plan\'s group limit — it should disappear instead of accepting a drop it can\'t fulfill.',
        // TODO(screenshot): both drop-zone affordances mid-hover, once available.
      },

      // --- From Now Open ---
      {
        heading: 'From "Now Open": dragging a live tab into a saved group',
        checks: 'That dragging an open tab from "Now Open" moves it into a saved group and closes the real tab.',
        steps: [
          'Drag a tab from the "Now Open" section into one of your saved groups.',
          'Check your actual open browser tabs after the drop.',
        ],
        example: {
          kind: 'image',
          src: '/beta/drag-now-open-tab.webp',
          width: 1600,
          height: 1200,
          alt: 'A tab from "Now Open" being dragged onto the Work group in the sidebar',
          caption: 'An open tab from "Now Open" dragged onto a saved group in the sidebar.',
        },
        good: [
          'This MOVES the tab, not copies it: the saved group gets a new window containing a snapshot of that tab.',
          'The real browser tab closes. If the tab you dragged was the active tab, it closes once you close the popup rather than immediately — that\'s intentional, not a bug.',
        ],
        report: 'The real tab stays open after the drop (making it look like a copy), or the popup itself closes/crashes mid-drag.',
      },

      // --- Cancel and edge cases ---
      {
        heading: 'Cancel and edge cases',
        checks: 'That cancelled or pointless drags change nothing, and that undo reverses a real drag.',
        steps: [
          'Start dragging a tab, then press Escape before dropping it.',
          'Start a drag and release it somewhere that isn\'t a valid target (e.g. outside the popup window, if you can manage it) or drop it back in the exact spot it started.',
          'After any successful drag, click the Undo button (header, top right).',
        ],
        example: {
          kind: 'image',
          src: '/beta/undo-redo-enabled.webp',
          width: 1600,
          height: 1200,
          alt: 'The TabMerger header with the Undo and Redo buttons enabled after a change',
          caption: 'The Undo/Redo buttons in the header, enabled after a change.',
        },
        good: [
          'Escape and an invalid/no-op drop leave everything exactly as it was — no duplicate tabs, no missing tabs, no reordering.',
          'Undo after a real drag restores the previous order exactly.',
        ],
        report: 'A tab is duplicated or goes missing after a cancelled or same-spot drag, or Undo doesn\'t fully restore the pre-drag order.',
      },

      // --- Keyboard drag ---
      {
        heading: 'Keyboard drag',
        checks: 'That everything you can drag with a mouse can also be moved with the keyboard, with spoken announcements.',
        steps: [
          'Press Tab until a saved tab, a window heading, or a group in the sidebar is focused. Each row is one Tab stop.',
          'To move several at once, press Ctrl+Space (Ctrl on a Mac too) on each one to select it, then focus any of the selected rows.',
          'Press Space to pick it up. You hear "Picked up …", the row leaves its spot, and a copy of it shows where it will land.',
          'Press Up or Down to move it. A tab moves through every window of the group, then onto "Drop here for a new window", then wraps around to the top.',
          'Press Left to go to the group list. Up and Down pick a group (the last stop is "New group"), and the main panel shows each group as you pass it.',
          'Press Right to enter the highlighted group, then use Up and Down to place the item inside it.',
          'Press Space to drop, or Escape to cancel.',
        ],
        good: [
          'Space picks the item up instead of opening the link.',
          'Ctrl+Space selects or deselects a row without opening it or picking it up.',
          'Enter still opens a tab, and does nothing while you\'re moving something.',
          'The copy of what you\'re moving is always on screen, and the panel scrolls to follow it.',
          'Up and Down wrap around at the ends, and you hear "Wrapped to top" or "Wrapped to bottom".',
          'An empty window is a place of its own.',
          'The item ends up exactly where the copy was, and you hear what happened.',
          'Several selected items move together as one block, in their original order.',
          'Space in the group list drops the item at the end of the highlighted group.',
          'On "New group" the main panel fades, and dropping there makes a brand-new group.',
          'A group moved with Up and Down can never go above "Now Open".',
          'Moving a live "Now Open" tab into a group closes that browser tab, as a mouse drop does.',
          'Escape leaves everything untouched and shows the group you started in again.',
          'After a drop, focus is on the moved row; after Escape, it\'s back on the row you picked up.',
        ],
      },

      // --- Persistence ---
      {
        heading: 'Persistence',
        checks: 'That a new order is saved: it survives reopening the popup and reaches your other devices.',
        pro: 'Only the second-device part needs Pro (it needs sync).',
        steps: [
          'After reordering tabs, windows, or groups by drag, close the popup entirely and reopen it.',
          'If you have sync enabled and a second device signed in to the same account, check the order there too.',
        ],
        good: [
          'The new order is exactly as you left it after reopening the popup.',
          'With sync on, the second device picks up the same order within a short time.',
        ],
      },
    ],
  },
  {
    id: 'web-app-and-dashboard',
    title: 'Web app and dashboard (preview site)',
    intro:
      'Everything here is at tabmerger-preview.vercel.app, not the main tabmerger.com — this beta build syncs with the preview site only.',
    items: [
      {
        heading: 'Signing up and signing in',
        checks: 'That every way of signing in to the website works: Google, email and password, and a magic link.',
        steps: [
          'From a signed-out state, open tabmerger-preview.vercel.app/auth/sign-in.',
          'Try "Continue with Google".',
          'Try email + password instead: enter your email and password, then click "Continue".',
          'Try "Send magic link" instead, using just your email.',
        ],
        example: {
          kind: 'image',
          src: '/beta/web-sign-in.webp',
          width: 1600,
          height: 1200,
          alt: 'The website\'s "Welcome back" sign-in page: Continue with Google, Email and Password fields with a Forgot? link, Continue, and Send magic link',
          caption: 'The website\'s sign-in page: Google, email and password, or a magic link.',
        },
        good: [
          'All three ways sign you in.',
          'The magic link and Google both redirect back into the app already signed in.',
          'New accounts land wherever "Sign up free" takes them (email + password or Google, same options).',
        ],
      },
      {
        heading: 'Creating an account with email and password',
        checks: 'That a new email-and-password account ends up signed in, whether or not the site asks you to verify your email.',
        steps: [
          'Signed out, click "Sign up free" and create an account with an email and a password (8+ characters).',
        ],
        example: {
          kind: 'image',
          src: '/beta/sign-up.webp',
          width: 1600,
          height: 1200,
          alt: 'The "Create your account" page: Continue with Google, then Email, Password (at least 8 characters) and Confirm password fields, and a Continue button',
          caption: 'The sign-up page. Google works here too; this item is about the email and password route.',
        },
        good: [
          'You either land straight in the dashboard, already signed in, or see "Verify your email" and are signed in only after clicking the link in that email. Which one depends on whether the site requires email confirmation; either is fine.',
        ],
        report: 'You see "Verify your email" but are actually already signed in (for example, opening the dashboard in another tab works without clicking the link).',
      },
      {
        heading: 'Forgot password and changing your password',
        checks: 'That you can reset a forgotten password by email, and change it afterwards.',
        steps: [
          'From sign-in, click "Forgot?" next to the password field and enter your email.',
          'Open the reset link from that email and set a new password (minimum 8 characters, and it must match its confirmation field).',
        ],
        example: {
          kind: 'image',
          src: '/beta/forgot-password.webp',
          width: 1600,
          height: 1200,
          alt: 'The "Reset your password" page: an Email field, a Send reset link button, and Back to sign in',
          caption: '"Forgot?" on the sign-in page opens this. Once signed in, Account settings has a "Change password" field instead.',
        },
        good: [
          'You land back in the dashboard already signed in with the new password.',
          'Signing in again afterward requires the new password, not the old one.',
        ],
      },
      {
        heading: 'Dashboard matches the extension after sync',
        checks: 'That the website\'s dashboard shows the same groups as your extension once sync has caught up.',
        pro: true,
        steps: [
          'With sync on and at least one group, open the dashboard at tabmerger-preview.vercel.app/dashboard.',
          'Compare the "Tab Groups" section there to the extension popup\'s sidebar: names, colors, window/tab counts and order.',
        ],
        example: {
          kind: 'image',
          src: '/beta/dashboard-groups.webp',
          width: 1600,
          height: 1200,
          alt: 'The web dashboard after unlocking: stats, the Pro plan card, and the Tab Groups grid with Research, Reading List, Work and Shopping cards showing window and tab counts',
          caption: 'The dashboard\'s groups, matching the extension\'s sidebar once synced.',
        },
        good: [
          'The same groups appear with the same names, colors, and window/tab counts, in the same order, once sync has caught up.',
        ],
      },
      {
        heading: 'The dashboard is read-only for groups',
        checks: 'That the dashboard shows your groups but can\'t change them: editing happens only in the extension.',
        pro: true,
        steps: [
          'On the dashboard, look for any way to rename, delete, or create a group, or star/unstar one.',
        ],
        good: [
          'There is no way to rename, delete, create, or (un)star a group from the dashboard — group edits are extension-only by design.',
          'The only real actions on a group card are Share and opening its tabs/windows.',
        ],
        report: 'Any control on the dashboard that appears to edit, delete, or create a group actually does something.',
      },
      {
        heading: 'Sessions and stats on the dashboard',
        checks: 'That the saved sessions and totals on the dashboard match the extension.',
        pro: true,
        steps: [
          'Save a session in the extension, then check the dashboard\'s "Saved Sessions" section.',
          'Check the stats near the top of the dashboard (tab count, group count, session count, member-since date).',
        ],
        good: [
          'The session you saved shows up.',
          'The stats match what you\'d count in the extension.',
        ],
      },
      {
        heading: 'Sharing from the dashboard',
        checks: 'That the dashboard\'s Share button copies a share link, like the extension\'s.',
        pro: true,
        steps: [
          'On a group card (or via "Select" and "Share selected" for multiple groups), click Share.',
        ],
        good: [
          'A link is copied to your clipboard immediately, with a toast confirming it. This is covered in depth in the "Sharing" section below — the dashboard\'s Share button and the extension\'s produce the same kind of link.',
        ],
      },
      {
        heading: 'Account page',
        checks: 'That the account page shows the right profile, plan and devices, and that both sign-out options work.',
        pro: 'Only the Devices card needs Pro; it lists the devices that sync.',
        steps: [
          'Open Account settings from the dashboard.',
          'Check the Profile card (email, member since), the Subscription card (plan, "Manage billing" or "Upgrade"), and the Devices card.',
          'Try "Sign out" and separately "Sign out of all devices".',
        ],
        example: {
          kind: 'image',
          src: '/beta/account-page.webp',
          width: 1600,
          height: 1200,
          alt: 'Account settings: the Subscription card shows the Pro plan, its renewal date and US$3.99/mo, with a Manage billing button; below it the Devices card lists signed-in devices',
          caption: 'The Subscription and Devices cards on a Pro account.',
        },
        good: [
          'Profile and Subscription show accurate, current info (see the "Upgrading to Pro" section above for the Subscription card in detail).',
          'Devices lists your signed-in devices with rename/remove controls.',
          'Both sign-out buttons return you to a signed-out state; "all devices" additionally revokes every other active session.',
          'There is no account-deletion option on this page — that\'s expected, not a gap to report.',
        ],
      },
      {
        heading: 'On a phone',
        checks: 'That the dashboard and account pages are fully usable on a small screen.',
        steps: [
          'Open the dashboard and Account settings on a phone (or a desktop window narrowed to about 390px wide).',
          'Tap the Dashboard and Account icons at the top, then the round account menu on the right and its "Sign out".',
        ],
        example: {
          kind: 'image',
          src: '/beta/phone-dashboard.webp',
          width: 780,
          height: 1200,
          alt: 'The dashboard on a phone-width screen: the top bar shows the TabMerger logo, the Dashboard and Account icons, the light/dark toggle and the account menu, with nothing cut off',
          caption: 'The dashboard at phone width: icons only in the top bar, nothing scrolls sideways.',
        },
        good: [
          'Nothing scrolls sideways.',
          'The top bar shows the TabMerger logo, the Dashboard and Account icons, the light/dark toggle and your account menu, all fully visible and tappable (the "TabMerger" name and the icon labels hide on narrow screens). Wider screens still show the labels.',
        ],
        report: 'A page scrolls sideways on a phone, or any control at the top is cut off or unreachable.',
      },
      {
        heading: 'Notifications (toasts)',
        checks: 'That pop-up notifications are easy to read, close on their own after a countdown, and can be closed early.',
        steps: [
          'Trigger a notification, for example: on Account settings, enter a password shorter than 8 characters in the password form and submit it (it shows an error without changing anything), or copy a share link.',
          'Watch the notification in the bottom-right corner, then trigger another and hover over it.',
          'Try it in both light and dark mode.',
        ],
        example: {
          kind: 'image',
          src: '/beta/toast.webp',
          width: 1600,
          height: 1200,
          alt: 'A red error notification in the bottom-right corner reading "Password must be at least 8 characters.", with a ✕ in its corner and a countdown bar partly emptied along its bottom edge',
          caption: 'An error notification: red edge, ✕ to close, and the countdown bar along the bottom.',
        },
        good: [
          'Each notification is easy to read against the page, with a colored edge (green for success, red for errors).',
          'A bar along its bottom empties over about 6 seconds and pauses while you hover, and the notification closes when it runs out.',
          'The ✕ in its top-right corner closes it straight away.',
        ],
        report: 'A notification is hard to read in either theme, the bar keeps running while you hover, or the ✕ is misplaced or doesn\'t close it.',
      },
    ],
  },
  {
    id: 'sharing',
    title: 'Sharing',
    intro:
      'Sharing requires Pro (see "Upgrading to Pro" above to get there in this beta). The encryption key for a share is generated fresh per link and lives only in the URL\'s #key= fragment — it\'s never sent to or stored on the server, so anyone who has the full link (including that fragment) can view the shared content. Treat a share link like the content itself.',
    items: [
      {
        heading: 'Sharing one or more groups from the extension',
        checks: 'That the extension creates a share link for one group, or for several at once.',
        pro: true,
        steps: [
          'Enter selection mode and check one or more groups in the sidebar (not tabs or windows — Share only appears for a group-type selection).',
          'Click "Share" in the selection bar at the bottom.',
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/share-extension.webp',
            width: 1600,
            height: 1200,
            alt: 'Selection mode in the popup with Work and Research checked and "2 groups selected" and a Share button in the bottom bar',
            caption: 'Check the groups to share, then click Share in the bottom bar.',
          },
          {
            kind: 'image',
            src: '/beta/share-extension-toast.webp',
            width: 1600,
            height: 1200,
            alt: 'The same screen with a green "Link copied to clipboard" notification',
            caption: 'The link is copied straight away.',
          },
        ],
        good: [
          'A link is copied to your clipboard right away, with a "Link copied to clipboard" toast.',
          'Selecting several groups at once shares all of them together as one link/bundle — you don\'t need to share them one at a time.',
        ],
      },
      {
        heading: 'Opening a shared link',
        checks: 'That anyone can open a share link without signing in and see the shared groups, read-only.',
        pro: 'Creating the link needs Pro; opening it needs no account at all.',
        steps: [
          'Open the copied link in a signed-out browser window (or a private/incognito window).',
          'Check the favicons and titles on each shared tab, and try "Open tab" / "Open all tabs" / "Open window" / "Open all windows".',
        ],
        example: {
          kind: 'image',
          src: '/beta/share-page.webp',
          width: 1600,
          height: 1200,
          alt: 'The shared page opened signed out: "Shared collection · read-only", the share link, "9 tabs across 5 windows in 2 groups", a Show page previews switch, and the Work group\'s tabs with Open buttons',
          caption: 'What someone opening your link sees, without signing in. (Here the link points at a local test server; yours will be on tabmerger-preview.vercel.app.)',
        },
        good: [
          'The page loads with no sign-in required, labeled "Shared collection · read-only".',
          'It shows every group, window, and tab with their real favicons and titles.',
          'The open buttons open the right tab(s)/window(s) in new browser tabs.',
        ],
      },
      {
        heading: 'Page previews on the shared page',
        checks: 'That page previews on a shared page stay off until the viewer turns them on and confirms.',
        pro: 'Creating the link needs Pro; opening it needs no account at all.',
        steps: [
          'On the shared page, find the "Show page previews" switch above the group list.',
          'Turn it on and confirm the dialog that appears.',
          'Hover a tab to see its preview image and description.',
        ],
        example: {
          kind: 'image',
          src: '/beta/share-page-previews.webp',
          width: 1600,
          height: 1200,
          alt: 'The "Turn on page previews?" dialog explaining what is sent to the preview service, with Cancel and Turn on buttons',
          caption: 'Turning on the switch asks first. Previews stay off until you confirm.',
        },
        good: [
          'The switch is off by default.',
          'Turning it on requires confirming a dialog first (turning it back off needs no confirmation) — the dialog explains that hovering a tab sends that tab\'s address to TabMerger\'s preview service, and that it isn\'t linked to your account, logged, or stored.',
          'Once on, hovering a tab shows its image/description; a page with no image shows "No preview" instead of a broken image.',
        ],
      },
      {
        heading: 'Sharing a group with many windows',
        checks: 'That a shared group with several windows shows each window separately.',
        pro: true,
        steps: ['Share a group that has several saved windows (not just one).'],
        example: {
          kind: 'image',
          src: '/beta/share-page-windows.webp',
          width: 1600,
          height: 1200,
          alt: 'The shared page\'s Research group, showing four separate windows, each with its own Open tab link, and "Open all windows" on the group',
          caption: 'A shared group with four windows: each window is listed separately.',
        },
        good: [
          'The shared page shows every window in that group, each labeled "Window N" (and "Incognito" if it was one), with its own tabs and its own "Open tab(s)" control.',
        ],
      },
      {
        heading: 'Sharing from the web dashboard instead of the extension',
        checks: 'That sharing from the website works the same way as from the extension.',
        pro: true,
        steps: [
          'On the dashboard, click "Share" on a single group card, or check several groups and click "Share selected".',
        ],
        example: {
          kind: 'image',
          src: '/beta/share-dashboard.webp',
          width: 1600,
          height: 1200,
          alt: 'The dashboard\'s group cards with one card\'s Share button showing "Copied!" and a notification reading "Link copied — shares a snapshot of this group."',
          caption: 'Share on a dashboard card copies the same kind of link.',
        },
        good: [
          'Both dashboard paths copy a link the same way the extension does ("Link copied — shares a snapshot of this group." or "Link copied! Share page is live." respectively), producing the same kind of shared page.',
        ],
      },
      {
        heading: 'Editing, re-sharing, revoking, and expiry — what\'s NOT possible',
        checks: 'What share links can\'t do yet, so you don\'t spend time reporting it.',
        pro: true,
        steps: [
          'Try to find any way to edit an existing share, or to revoke/delete/expire one, from either the extension or the dashboard.',
        ],
        good: [
          'There is currently no UI anywhere to edit, revoke, delete, or expire a share link once created — a share is a permanent, immutable snapshot from the moment it\'s made. This is expected — don\'t report the absence of a revoke/edit/expiry control, just confirm it matches this description.',
          'Re-sharing the same group creates a brand-new, separate link rather than updating the old one; the old link keeps working and still shows the old snapshot.',
        ],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    intro:
      'Settings has General, Account, and Data tabs for everyone. A Devices tab appears once you\'re on Pro (see "Upgrading to Pro" above). AI and Dev tabs are not part of this beta build — AI stays hidden behind the "coming soon" flag, and Dev only shows in local development builds, not the beta you installed.',
    items: [
      {
        heading: 'General tab — Theme, Confirm before deleting, Open tab on click, Auto-deduplicate',
        checks: 'That these General settings take effect right away and are remembered.',
        steps: [
          'Open Settings and switch Theme between Light, Dark, and System.',
          'Toggle "Confirm before deleting" (delete a group or window with it on, then off, and compare).',
          'Toggle "Open tab on click", then click a saved tab in the main panel.',
          'Toggle "Auto-deduplicate on merge", then merge two windows that share a duplicate tab.',
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-general.webp',
          width: 1600,
          height: 1200,
          alt: 'The Settings modal General tab, showing Theme, Confirm before deleting, and other toggles',
          caption: 'The General tab of Settings, with the version badge next to the title. (The Dev tab only exists in our internal screenshot build; you won\'t see it.)',
        },
        good: [
          'Theme changes the whole UI immediately and survives closing/reopening the popup.',
          'With "Confirm before deleting" on, deleting a group or window asks first; off, it deletes immediately.',
          '"Open tab on click" on: a single click opens the tab in the browser; off: single click just selects/expands it.',
          '"Auto-deduplicate on merge" removes the duplicate automatically when on.',
        ],
      },
      {
        heading: 'General tab — Show page images in previews',
        checks: 'That the page-images setting controls whether tab previews show a page image.',
        steps: [
          'Toggle "Show page images in previews" off.',
          'Hover a saved tab to see its preview.',
          'Turn the setting back on and hover the same tab again.',
        ],
        example: {
          kind: 'image',
          src: '/beta/hover-preview-off.webp',
          width: 1600,
          height: 1200,
          alt: 'A tab hover preview with page images disabled, showing a "Not enabled" placeholder',
          caption: 'The hover preview with "Show page images in previews" off.',
        },
        good: [
          'Off: the preview clearly says "Not enabled" with the note "Page images are off. Turn on in Settings." — the switch itself saves right away, no confirmation dialog.',
          'On: a real page image loads in the hover preview, or "No preview" if that page has none.',
          'The setting\'s own description links to the privacy policy\'s page-previews section.',
        ],
        report: 'The preview shows "No preview" (blank) instead of a real image with the setting on and a page that has one.',
      },
      {
        heading: 'General tab — Cloud sync, Stale tab threshold, URL rules',
        checks: 'That these settings appear for the right plans and change what they should.',
        pro: 'Only the Cloud sync switch needs Pro (Free doesn\'t show it).',
        steps: [
          'With Pro, toggle "Cloud sync" (this control only appears once you have Pro).',
          'Change "Stale tab threshold" to a different value (7/14/30/60 days).',
          'Click "Manage" next to "URL rules" and add a rule assigning a URL pattern to a group.',
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-urlrules.webp',
          width: 1600,
          height: 1200,
          alt: 'Settings, General tab scrolled down: Cloud sync on, Stale tab threshold set to 30 days, and URL rules with a Manage button',
          caption: 'The lower half of the General tab. (The Dev tab only exists in our internal screenshot build; you won\'t see it.)',
        },
        good: [
          'Cloud sync only shows up for Pro accounts (Free never sees it).',
          'Changing the stale-tab threshold changes which tabs get the amber stale dot.',
          'URL rules opens a manager where you can add/edit/remove pattern-to-group rules.',
          'A newly-opened tab matching a rule gets auto-assigned.',
        ],
      },
      {
        heading: 'Theme: Light, Dark and System',
        checks: 'That every theme looks right across the popup, and that the choice is remembered.',
        steps: [
          'In Settings → General, set Theme to Dark and click Save changes.',
          'Look around the popup: the sidebar, a group with several windows, the ⋯ menus, a right-click menu, Search (Ctrl+K), and Settings itself.',
          'Close and reopen the popup.',
          'Set Theme to System and save, then switch your computer between light and dark mode.',
          'Set it back to Light.',
        ],
        good: [
          'The whole popup switches theme as soon as you save, with every text, icon and border readable.',
          'Menus, dialogs, tooltips and notifications follow the theme too.',
          'The theme is still set after reopening the popup.',
          'System follows your computer\'s light or dark setting.',
        ],
        report: 'Anything is hard to read or keeps the old theme (a menu, dialog, icon or border), or the theme resets after reopening the popup.',
      },
      {
        heading: 'URL rules: saving matching pages automatically',
        checks: 'That a URL rule saves pages you open at matching addresses into the group you chose.',
        steps: [
          'In Settings → General, next to URL rules, click Manage, then Add rule.',
          'Enter a pattern with * as a wildcard (e.g. github.com/*), pick a group, add the rule, and click Save.',
          'In the browser, open a new tab at an address that matches (e.g. any github.com page).',
          'Open the popup and look at the rule\'s group. Then reload the page once, and check the group again.',
          'Edit the rule to point at another group, then delete it, and open another matching page.',
          'On Free, try adding a fourth rule.',
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-urlrules-manager.webp',
          width: 1600,
          height: 1200,
          alt: 'The URL Rules dialog: "Auto-assign tabs to groups by URL pattern. Use * as a wildcard (e.g. github.com/*). First matching rule wins.", no rules yet, an Add rule button, and Cancel and Save',
          caption: 'Settings → General → URL rules → Manage opens this editor.',
        },
        good: [
          'A copy of the matching page is saved into the rule\'s group, in its first window (or a new window if the group has none). The tab itself stays open.',
          'When several rules match, the first one in the list wins.',
          'Once a rule is edited or deleted, new pages follow the change.',
          'Free allows 3 rules: adding a fourth shows "Free plan allows up to 3 URL rules." with an Upgrade button. Pro has no limit.',
        ],
        report: 'A matching page isn\'t saved, lands in the wrong group, or is saved more than once (for example again every time you reload it).',
      },
      {
        heading: 'Account tab — Plan, Renews, Email, Manage billing / Upgrade, Sign out',
        checks: 'That the Account tab shows your real plan, renewal date and email, and that its buttons work.',
        steps: [
          'Open the Account tab and check the Plan, Renews (if paid), and Email rows.',
          'Click "Upgrade to Pro" (Free) or "Manage billing" (Pro/Pro AI) — see "Upgrading to Pro" above for what happens next.',
          'Click "Sign out".',
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-account.webp',
          width: 1600,
          height: 1200,
          alt: 'Settings, Account tab on Pro: Plan Pro (US$3.99/mo), a renewal date, the email, Manage billing and Sign out buttons, and "Forgot your passphrase? Reset encryption"',
          caption: 'The Account tab on a Pro account. The reset link at the bottom is the next item. (The Dev tab only exists in our internal screenshot build; you won\'t see it.)',
        },
        good: [
          'Plan shows "Free", "Pro (US$3.99/mo)", or "Pro AI (US$7.99/mo)" matching your real subscription.',
          'Renews only shows for a paid plan and gives the real renewal date.',
          'Email matches your signed-in account.',
          '"Manage billing" opens Stripe\'s billing portal in a new tab; on Free it\'s "Upgrade to Pro" instead, opening the pricing page.',
          'Sign out returns you to a signed-out state.',
        ],
      },
      {
        heading: 'Account tab — Forgot your passphrase? Reset encryption',
        checks: 'That the encryption-reset link appears in the Account tab once encryption is set up.',
        pro: true,
        steps: [
          'This link only appears if you\'ve completed encryption setup at least once (see the "End-to-end encryption passphrase" section below for the full flow — don\'t repeat that here, just confirm it\'s reachable from this tab).',
        ],
        good: [
          'The link is visible at the bottom of the Account tab once encryption is set up, and not before.',
        ],
      },
      {
        heading: 'Data tab — Export, Import, Clear all data',
        checks: 'That exporting, importing and clearing your data work, with a confirmation before anything is replaced or deleted.',
        steps: [
          'Open the Data tab and click "Export" to download all groups as a JSON file.',
          'Click "Import" and select that same file (or a Bookmarks HTML export, or a OneTab .txt export).',
          'Click "Clear all data" and confirm.',
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-import-export.webp',
          width: 1600,
          height: 1200,
          alt: 'The Settings modal Data tab, showing Export data and Import data controls',
          caption: 'The Data tab of Settings.',
        },
        good: [
          'Export downloads a file named like "tabmerger-backup-2026-01-15.json" with an "exported successfully" toast.',
          'Import asks you to confirm the group count before importing, then shows "imported successfully".',
          'Re-importing your own export brings back every group with the same windows, tabs, order and colours.',
          'All three file types (TabMerger JSON, Bookmarks HTML, OneTab .txt) are accepted, detected by file extension.',
          '"Clear all data" wipes groups, sessions, and settings after you confirm — treat it as destructive and only try it on a throwaway profile.',
        ],
        report: 'A bad or empty file silently does nothing instead of showing an error toast like "Invalid file format" or "No groups found".',
      },
      {
        heading: 'Save vs Reset, and the "Unsaved changes" indicator',
        checks: 'That settings only save when you click Save, and warn you about unsaved changes.',
        steps: [
          'On the General tab, change any setting (e.g. Theme) without clicking Save.',
          'Notice the "Unsaved changes" text and that "Save changes" is only enabled while something is actually different from what\'s saved.',
          'Click "Restore defaults" instead of Save, then close Settings without saving.',
          'Reopen Settings and check whether your change stuck.',
        ],
        example: {
          kind: 'image',
          src: '/beta/settings-unsaved.webp',
          width: 1600,
          height: 1200,
          alt: 'Settings, General tab after a change: "Unsaved changes" next to an enabled Save changes button, with Restore defaults on the left',
          caption: 'After changing a setting: "Unsaved changes" appears and Save changes turns on. (The Dev tab only exists in our internal screenshot build; you won\'t see it.)',
        },
        good: [
          '"Unsaved changes" appears next to "Save changes" whenever the draft differs from the last saved settings.',
          '"Save changes" is disabled when there\'s nothing new to save.',
          '"Restore defaults" only resets the in-progress draft back to defaults — it does not save by itself.',
          'Closing Settings without clicking "Save changes" discards the draft; reopening shows the last actually-saved values, not your unsaved edit.',
        ],
        report: '"Save changes" stays enabled with no changes made, or a setting you changed but never saved persists after closing and reopening Settings anyway.',
      },
      {
        heading: 'The version badge',
        checks: 'Where to find the exact version number to put in bug reports.',
        steps: ['Look at the Settings dialog title bar.'],
        good: [
          'A small badge next to the word "Settings" shows the real semver you should report in bug reports (e.g. "v3.1.0-beta.5") — this is covered in more detail in the "Join and install" section above.',
        ],
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
        heading: 'Setting up two devices',
        checks: 'That two devices signed in to the same account share their groups.',
        pro: true,
        steps: [
          'Sign in on two devices or two browser profiles with the beta extension installed on both, pointed at the same account.',
        ],
        example: [
          {
            kind: 'image',
            src: '/beta/sign-in.webp',
            width: 1600,
            height: 1200,
            alt: 'The extension\'s "Sign In to TabMerger" dialog in the popup: Continue with Google, then Sign In, Sign Up and Magic Link tabs with Email and Password fields',
            caption: 'Signing in from the extension: the account icon (top right) → Sign in.',
          },
          {
            kind: 'image',
            src: '/beta/sync-device-a.webp',
            width: 1600,
            height: 1200,
            alt: 'Device A\'s popup with the groups Work, Research, Shopping and Reading List; the footer reads 4 Groups, 4 Windows, 17 Tabs',
            caption: 'Device A.',
          },
          {
            kind: 'image',
            src: '/beta/sync-device-b.webp',
            width: 1600,
            height: 1200,
            alt: 'Device B\'s popup after signing in, unlocking and syncing: the same four groups with the same window and tab counts, and the same 4 Groups, 4 Windows, 17 Tabs footer',
            caption: 'Device B after signing in and unlocking: the same groups and counts, in the same order.',
          },
        ],
        good: [
          'Groups created on one device appear on the other within a short time.',
        ],
      },
      {
        heading: 'Renames reach the other device',
        checks: 'That a rename on one device shows up on the other without a manual refresh.',
        pro: true,
        steps: ['Edit a group name on device A.', 'Check device B without touching anything there.'],
        example: [
          {
            kind: 'image',
            src: '/beta/sync-rename-a.webp',
            width: 1600,
            height: 1200,
            alt: 'Device A\'s popup after renaming Research to "Research papers", with its four tabs shown',
            caption: 'Device A: "Research" renamed to "Research papers".',
          },
          {
            kind: 'image',
            src: '/beta/sync-rename-b.webp',
            width: 1600,
            height: 1200,
            alt: 'Device B\'s popup showing the group as "Research papers" with the same four tabs, after only reopening the popup',
            caption: 'Device B, after just reopening the popup: the new name is there.',
          },
        ],
        good: [
          'Device B picks up the rename without you needing to trigger a manual refresh.',
        ],
      },
      {
        heading: 'Deletes reach the other device',
        checks: 'That a deleted group stays deleted on every device instead of coming back.',
        pro: true,
        steps: ['Delete a group on device A.', 'Confirm it also disappears on device B.'],
        example: [
          {
            kind: 'image',
            src: '/beta/sync-delete-a.webp',
            width: 1600,
            height: 1200,
            alt: 'Device A\'s popup after deleting Shopping: Work, Research papers and Reading List remain, and the footer reads 3 Groups, 3 Windows, 14 Tabs',
            caption: 'Device A: "Shopping" deleted.',
          },
          {
            kind: 'image',
            src: '/beta/sync-delete-b.webp',
            width: 1600,
            height: 1200,
            alt: 'Device B\'s popup after reopening: Shopping is gone and the footer reads 3 Groups, 3 Windows, 14 Tabs',
            caption: 'Device B after reopening the popup: "Shopping" is gone there too.',
          },
        ],
        good: [
          'The deletion propagates instead of the group reappearing ("resurrecting") after sync.',
        ],
        report: 'A deleted group comes back on either device after a later sync.',
      },
      {
        heading: 'Reordering groups syncs',
        checks: 'That the order of your groups is the same on every device and on the dashboard.',
        pro: true,
        steps: [
          'Drag a group to a new position in the sidebar on device A.',
          'Wait for sync to catch up, then look at device B\'s sidebar and the web dashboard.',
        ],
        good: [
          'Device B and the dashboard show the groups in the same order as device A.',
          'Undo may be greyed out on a device right after a sync brings in changes from another device. That is expected: the undo history is cleared when changes arrive from elsewhere, so you can\'t accidentally undo over someone else\'s edit.',
        ],
        report: 'The order differs between devices after sync has caught up, or a reorder jumps back to the old order.',
      },
      {
        heading: 'Offline changes sync when you reconnect',
        checks: 'That changes made offline sync once you\'re back online, without duplicates or losses.',
        pro: true,
        steps: ['Go offline (disable network) on one device.', 'Make changes.', 'Reconnect.'],
        good: [
          'Once back online, changes made offline sync up without duplicating or silently dropping groups.',
        ],
      },
      {
        heading: 'Deleting a group while offline',
        checks: 'That a group you delete while offline stays deleted once you reconnect.',
        pro: true,
        steps: [
          'Go offline (disable network) on device A.',
          'Delete a group on device A.',
          'Reconnect device A and let it sync, then check device B and the dashboard.',
        ],
        good: [
          'The group is removed from the server on the next sync and disappears on device B and the dashboard.',
          'It does not come back on either device afterwards.',
        ],
        report: 'A group you deleted while offline reappears on any device after a sync.',
      },
      {
        heading: 'Same group edited on two devices (conflict copy)',
        checks: 'That when the same group is edited on two devices before either has synced, nothing is overwritten and you get a copy to merge by hand.',
        pro: true,
        steps: [
          'Go offline (disable network) on device A. Leave device B online.',
          'On device A, edit a group (for example add a tab). On device B, edit the same group differently (for example add a different tab).',
          'Let device B sync first, then reconnect device A and let it sync.',
          'Look at the sidebar on both devices.',
        ],
        good: [
          'The version that reached the server first (device B) keeps the group\'s name.',
          `Device A's version is saved right below it as a new group named "Work${CONFLICT_COPY_SUFFIX}" (using your group's name), and a toast tells you so.`,
          'Both devices end up showing both groups. You can merge the tabs by hand and then delete the copy.',
          'Editing only one device, or editing different groups on each, never makes a copy.',
        ],
        report: 'An edit silently disappears with no copy, or a "conflict copy" appears when only one device edited the group.',
      },
    ],
  },
  {
    id: 'encryption',
    title: 'End-to-end encryption passphrase',
    intro:
      'Encryption is mandatory for every signed-in account, not an opt-in setting — there\'s no toggle to turn it off. Your synced groups, sessions, and "Now Open" snapshots are encrypted with a key only your passphrase can unlock; TabMerger\'s servers never see the passphrase or the unwrapped key.',
    items: [
      {
        heading: 'First-time passphrase setup',
        checks: 'That turning on sync asks you to choose an encryption passphrase before any of your data leaves your device.',
        pro: true,
        steps: [
          'On a fresh sign-in with cloud sync, wait for the "Set up encryption" prompt to appear on its own (it\'s triggered by the first sync attempt).',
          'Read the prompt text, then enter a new passphrase and repeat it in "Confirm passphrase".',
          'Click "Set up encryption".',
        ],
        example: {
          kind: 'image',
          src: '/beta/encryption-setup.webp',
          width: 1600,
          height: 1200,
          alt: 'The "Set up encryption" dialog explaining the passphrase can\'t be recovered, with New passphrase and Confirm passphrase fields and a Set up encryption button',
          caption: 'Appears on its own right after signing in on Pro.',
        },
        good: [
          'The prompt reads "Your synced group and tab data is end-to-end encrypted with a passphrase only you know. Choose one now — there is no way to recover your data if you forget it, it never leaves your device and TabMerger cannot reset it for you."',
          'The passphrase must be at least 8 characters with no spaces, and must match its confirmation — mismatches or a too-short passphrase show a clear inline error ("Passphrase must be at least 8 characters" / "Passphrases do not match" / "Passphrase cannot contain spaces") instead of silently failing.',
          'On success you see an "Encryption set up" toast.',
          'Nothing you already synced is lost.',
        ],
      },
      {
        heading: 'Unlocking on a second device',
        checks: 'That a second device needs your passphrase once before it can read your synced data.',
        pro: true,
        steps: [
          'Sign in with the same account on a second device or browser profile.',
          'When the "Unlock encryption" prompt appears, enter your passphrase (once, there is no confirmation field) and click "Unlock" or press Enter.',
          'Repeat once more, but deliberately type the wrong passphrase.',
        ],
        example: {
          kind: 'image',
          src: '/beta/encryption-unlock.webp',
          width: 1600,
          height: 1200,
          alt: 'The "Unlock encryption" dialog on a second device, with a single Passphrase field and an Unlock button',
          caption: 'On a second device, the extension asks for your existing passphrase once.',
        },
        good: [
          'The unlock prompt reads "Enter your encryption passphrase to unlock synced data on this device. This is a one-time step per device — you won\'t be asked again unless you sign out."',
          'The correct passphrase unlocks and shows an "Encryption unlocked" toast.',
          'The wrong one shows "Wrong passphrase" and changes nothing else — no corruption, no lockout, you can just try again.',
        ],
      },
      {
        heading: 'What "locked" looks like, and staying unlocked after a restart',
        checks: 'That locked data stays unreadable until you unlock it, and a device stays unlocked after restarting the browser.',
        pro: true,
        steps: [
          'While a device is locked (before you\'ve entered the passphrase there), try to use cloud sync features.',
          'Unlock it, then fully quit and reopen your browser (not just the popup) on that device.',
        ],
        good: [
          'While locked, you get re-prompted for the passphrase rather than silently syncing plaintext or losing data.',
          'Once unlocked, the key persists in the browser\'s local storage on that device — a full browser restart does not re-prompt you; only signing out clears it.',
        ],
      },
      {
        heading: 'Forgot your passphrase — resetting encryption',
        checks: 'That resetting encryption is clearly confirmed first, and lets you set a new passphrase.',
        pro: true,
        steps: [
          'In Settings → Account, find "Forgot your passphrase? Reset encryption" (only shown once you\'ve completed setup at least once).',
          'Do NOT use this on data you care about — it permanently discards access to everything encrypted under your current passphrase. Use a throwaway test account if you want to try it.',
          'If you do try it, confirm the reset dialog, then set a brand-new passphrase when the setup prompt reopens.',
        ],
        example: {
          kind: 'image',
          src: '/beta/encryption-reset.webp',
          width: 1600,
          height: 1200,
          alt: 'The "Reset Encryption Passphrase" confirmation warning that everything encrypted under the current passphrase becomes permanently inaccessible, with Cancel and Reset Passphrase buttons',
          caption: 'The confirmation you get before a reset. Cancel is safe; Reset Passphrase is not reversible.',
        },
        good: [
          'The confirmation dialog is clear before anything happens.',
          'After confirming, you see an "Encryption reset — set up a new passphrase" toast and the setup prompt reopens immediately so you can pick a new one and keep syncing.',
        ],
      },
      {
        heading: 'Verifying on the web dashboard',
        checks: 'That the website asks for your passphrase before it shows your synced groups.',
        pro: true,
        steps: [
          'Sign in to the dashboard (tabmerger-preview.vercel.app) with an account that has encryption set up.',
          'If prompted, enter your passphrase in the inline unlock card before any group content appears.',
        ],
        example: {
          kind: 'image',
          src: '/beta/dashboard-passphrase.webp',
          width: 1600,
          height: 1200,
          alt: 'The web dashboard\'s Tab Groups section locked, with a padlock, "Your groups are end-to-end encrypted. Enter your passphrase to view them here.", a Passphrase field and an Unlock button',
          caption: 'Until you enter your passphrase, the dashboard shows this instead of your groups.',
        },
        good: [
          'The dashboard asks for the passphrase separately from the extension — unlocking there is its own one-time-per-tab step, not shared with the extension\'s unlock. The prompt reads "Your groups are end-to-end encrypted. Enter your passphrase to view them here."',
          'A wrong passphrase shows "Incorrect passphrase." without crashing the page.',
          'Once unlocked, your real group names and tabs render normally.',
          'After a passphrase reset in the extension, the dashboard asks for the new passphrase: on the next page load, or in a dashboard that was already open, once you press the refresh button on the sync label.',
          'A group or session the current passphrase cannot read (saved before a reset and not uploaded again yet) shows as "(locked)" instead of leaking any content. The item itself says why and what to do, and it cannot be shared or restored until it is readable again.',
        ],
      },
      {
        heading: 'How to tell your data really is encrypted',
        checks: 'How you can see for yourself that your data is unreadable without your passphrase.',
        pro: true,
        steps: [
          'There\'s no explicit "Encrypted ✓" badge in the UI — the visible signal is indirect.',
          'On a device where you haven\'t unlocked yet (or the dashboard, before entering your passphrase there), notice that group names/content don\'t render until you unlock.',
        ],
        good: [
          'The absence of readable content before unlocking is the signal: no group name or tab is shown, and on the dashboard anything the current passphrase cannot read renders as "(locked)".',
          'The dashboard shows the passphrase card instead of your groups. If content were ever readable without unlocking, that would mean it isn\'t actually encrypted — report it immediately if you see that.',
        ],
      },
    ],
  },
]

const WANT_TO_HEAR_ABOUT = [
  'Any data loss — a group, tab, or session that disappeared and shouldn\'t have.',
  `Sync conflicts — a "${CONFLICT_COPY_SUFFIX.trim()}" group is expected when the same group was edited on two devices before either synced. Tell us if an edit silently disappears, or if a copy appears when only one device edited.`,
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
          testing yet.
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
                <span className="text-foreground font-medium">Which browsers can I test on?</span>{' '}
                Chrome, Edge, Brave, Vivaldi, Arc, and Opera all use this same TabMerger BETA
                listing and the same Google Group — there's no separate Edge beta, so don't go
                looking for one. Edge: accept "Allow extensions from other stores" when prompted.
                Opera: install Opera's "Install Chrome Extensions" add-on first, then use the link
                above. If you also have the stable TabMerger installed from the Edge Add-ons
                store, turn it off while testing the beta — it's a separate extension from this
                one. Safari isn't supported.
              </li>
              {FIREFOX_BETA_CONFIGURED ? (
                <li id="firefox">
                  <span className="text-foreground font-medium">Firefox.</span> Firefox has its
                  own beta build, installed from a direct link rather than the Chrome Web Store
                  listing above.{' '}
                  <a
                    href={FIREFOX_BETA_XPI_URL}
                    className="underline underline-offset-4 hover:text-foreground transition-colors"
                  >
                    Install the Firefox beta
                  </a>
                  . Firefox asks whether to add "TabMerger BETA": choose Add. It checks for
                  updates on its own roughly once a day; to check right now, open{' '}
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">about:addons</code>,
                  click the gear icon, and choose "Check for Updates." Sign in once inside the
                  extension and allow Firefox's data permission prompt (it covers sign-in and sync);
                  after that, signing in on this website also signs the extension in.{' '}
                  <strong className="text-foreground">
                    Anyone with the install link above can install it
                  </strong>{' '}
                  — please don't share it outside the tester group.
                </li>
              ) : (
                <li>
                  <span className="text-foreground font-medium">Firefox.</span> A Firefox beta is
                  coming soon; until then, Firefox users can join the beta with any of the
                  supported Chromium browsers listed above (Chrome, Edge, Brave, Vivaldi, Arc,
                  Opera).
                </li>
              )}
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
            <div className="flex flex-wrap items-center justify-between gap-2 -mt-3 mb-4">
              <p className="text-muted-foreground text-sm leading-relaxed">
                Tick each step as you go. Your checkmarks are saved in this browser only, and each
                area shows how far you&apos;ve got.
              </p>
              <BetaChecklistReset />
            </div>
            <div className="mb-6 border px-3 py-2 text-sm text-muted-foreground leading-relaxed">
              <p className="font-medium text-foreground mb-1">Do I need Pro?</p>
              <p>
                Areas are listed from Free to Pro. Everything unmarked works on Free, without an
                account. <ProBadge partial={false} />: the whole item needs a Pro account (sync,
                encryption and creating share links are Pro). <ProBadge partial />: most of the
                item works on Free, and a &quot;Pro:&quot; line under its title says which part
                doesn&apos;t. Pro costs nothing in this beta: you pay with a test card (see{' '}
                <a href="#upgrading-to-pro" className="underline underline-offset-4 hover:text-foreground">
                  Upgrading to Pro
                </a>
                ).
              </p>
            </div>
            <div className="space-y-3">
              {TEST_AREAS.map((area, a) => (
                <Fragment key={area.id}>
                {(a === 0 || areaAccess(TEST_AREAS[a - 1]) !== areaAccess(area)) && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-3 first:pt-0">
                    {AREA_ACCESS_LABELS[areaAccess(area)]}
                  </p>
                )}
                <details id={area.id} className="scroll-mt-24 group rounded-none border">
                  <summary className="cursor-pointer list-none px-4 py-3 font-medium text-sm flex items-center justify-between">
                    <span className="flex flex-wrap items-center gap-2">
                      {area.title}
                      {area.items.some((item) => item.pro) && (
                        <ProBadge partial={!area.items.every((item) => item.pro === true)} scope="area" />
                      )}
                    </span>
                    <BetaAreaProgress areaId={area.id} items={area.items} />
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
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                            <h3 className="text-foreground font-semibold text-[0.8125rem] uppercase tracking-wide">
                              {item.heading}
                            </h3>
                            {item.pro && <ProBadge partial={item.pro !== true} />}
                          </div>
                          {typeof item.pro === 'string' && (
                            <p className="text-muted-foreground mb-1">
                              <span className="font-medium text-foreground/80">Pro: </span>
                              {item.pro}
                            </p>
                          )}
                          <p className="text-muted-foreground mb-3">
                            <span className="font-medium text-foreground/80">What this checks: </span>
                            {item.checks}
                          </p>
                          <p className="text-foreground font-medium mb-1.5">Steps</p>
                          <BetaStepList areaId={area.id} steps={item.steps} />
                          {toExamples(item.example).map((example, e) => (
                            <div key={e} className="mb-3 max-w-full">
                              {example.kind === 'image' ? (
                                <div
                                  className={cn(
                                    'max-w-full overflow-hidden rounded-none border',
                                    // Portrait (phone) shots at full column width would be taller
                                    // than most screens.
                                    example.height > example.width && 'w-72',
                                  )}
                                >
                                  <Image
                                    src={example.src}
                                    alt={example.alt}
                                    width={example.width}
                                    height={example.height}
                                    loading="lazy"
                                    quality={90}
                                    // Matches the content column's real max width (max-w-2xl =
                                    // 672px) so HiDPI screens request the 2× screenshot source
                                    // instead of Next's default-quality, softened downscale.
                                    sizes={example.height > example.width ? '288px' : '(min-width: 1024px) 672px, 100vw'}
                                    className="w-full h-auto"
                                  />
                                </div>
                              ) : example.kind === 'testCards' ? (
                                <div className="space-y-3">
                                  <div
                                    role="note"
                                    className="rounded-none border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-foreground"
                                  >
                                    <span className="font-medium">⚠ This is a test checkout.</span> Never
                                    enter a real card. No real money is charged, and a real card
                                    won&apos;t work here anyway.
                                  </div>
                                  <table className="w-full border text-left text-[13px]">
                                    <tbody>
                                      {STRIPE_TEST_CARDS.map((card) => (
                                        <tr key={card.number} className="border-t first:border-t-0">
                                          <th scope="row" className="px-3 py-2 font-normal text-muted-foreground">
                                            {card.label}
                                            {card.note && (
                                              <span className="block text-[11px] text-primary">{card.note}</span>
                                            )}
                                          </th>
                                          <td className="px-3 py-2">
                                            <code className="select-all whitespace-nowrap bg-muted px-1.5 py-0.5 font-mono">
                                              {card.number}
                                            </code>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <p className="text-muted-foreground">
                                    With any card: an expiry date in the future (e.g. <code>12/34</code>), any
                                    3-digit CVC (e.g. <code>123</code>), and anything for the name, postal
                                    code and other fields. More cards:{' '}
                                    <a
                                      href="https://docs.stripe.com/testing"
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline underline-offset-4 hover:text-foreground"
                                    >
                                      docs.stripe.com/testing
                                    </a>
                                    .
                                  </p>
                                </div>
                              ) : (
                                <pre className="max-w-full overflow-x-auto rounded-none border bg-muted/50 p-3 text-[11px] leading-relaxed whitespace-pre">
                                  {example.content}
                                </pre>
                              )}
                              {example.caption && (
                                <p className="mt-1 text-[11px] text-muted-foreground italic">
                                  {example.caption}
                                </p>
                              )}
                            </div>
                          ))}
                          <BetaGoodCheck areaId={area.id} good={item.good} />
                          {item.report && (
                            <p className="text-muted-foreground mt-2">
                              <span className="font-medium text-foreground/80">Report it if: </span>
                              {item.report}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
                </Fragment>
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

          {/* Known issues (lib/knownIssues.ts, kept current) */}
          <section id="known-issues" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">3. Known issues</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              We already know about these, so there's no need to report them. The list is updated
              with every beta release; if something here is fixed for you, or behaves differently
              from how it's described, that is worth reporting.
            </p>
            <ul className="space-y-4">
              {KNOWN_ISSUES.map((issue) => (
                <li
                  key={issue.id}
                  id={`known-issue-${issue.id}`}
                  className="border-l-2 border-border pl-4 scroll-mt-24"
                >
                  <p className="text-sm font-medium">
                    <span className="mr-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                      {issue.area}
                    </span>
                    {issue.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{issue.details}</p>
                  {issue.workaround && (
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">Meanwhile:</span> {issue.workaround}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Report bugs */}
          <section id="report-bugs" className="scroll-mt-24">
            <h2 className="text-xl font-semibold mb-4">4. Report a bug</h2>
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
              <Button asChild variant="outline">
                <a href={IDEA_DISCUSSION_URL} target="_blank" rel="noreferrer">
                  <GitHubMark className="h-4 w-4" />
                  Share an idea on GitHub
                </a>
              </Button>
            </div>
            <div className="mb-5">
              <Link
                href="/contact?topic=beta"
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
                <h3 className="font-medium text-foreground mb-1">Will I be charged if I upgrade to Pro?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  No — upgrading in the beta uses Stripe's test mode. Use a{' '}
                  <a
                    href="https://docs.stripe.com/testing"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-foreground transition-colors"
                  >
                    Stripe test card
                  </a>{' '}
                  (see the "Upgrading to Pro" section above) — no real card works here, and no real
                  money changes hands either way.
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
