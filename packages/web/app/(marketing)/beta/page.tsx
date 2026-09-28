import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LegalToc } from '@/components/legal-toc'
import { FREE_TIER_LIMITS, FIREFOX_BETA } from '@tabmerger/shared'

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
  { id: 'report-bugs', label: 'Report a bug' },
  { id: 'faq', label: 'FAQ' },
]

type Example =
  | { kind: 'image'; src: string; width: number; height: number; alt: string; caption?: string }
  | { kind: 'ascii'; content: string; caption?: string }
  | { kind: 'testCards'; caption?: string }

// Stripe's published test cards (https://docs.stripe.com/testing). Test mode only:
// a real card is rejected, and none of these ever move money.
const STRIPE_TEST_CARDS: { label: string; number: string; note?: string }[] = [
  { label: 'Successful payment (Visa)', number: '4242 4242 4242 4242', note: 'Use this one to upgrade' },
  { label: 'Generic decline', number: '4000 0000 0000 0002' },
  { label: 'Insufficient funds', number: '4000 0000 0000 9995' },
  { label: 'Needs 3D Secure authentication', number: '4000 0025 0000 3155' },
]

type TestItem = {
  // Optional sub-section heading rendered above this item's steps — used to
  // break a long area (like drag-and-drop) into named groups (Sorting,
  // Cross-window, etc.) without a separate data structure.
  heading?: string
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
          width: 1600,
          height: 1200,
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
          width: 1600,
          height: 1200,
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
        example: {
          kind: 'image',
          src: '/beta/archive-section.webp',
          width: 1600,
          height: 1200,
          alt: 'The Archived section at the bottom of the TabMerger sidebar, expanded to show an archived group',
          caption: 'The Archived section, collapsed by default at the bottom of the sidebar.',
        },
        good: 'Archived groups disappear from the active list but are never deleted — they reappear exactly as they were once restored.',
      },
      {
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
          caption: 'The Sessions section of the sidebar.',
        },
        good: 'Restoring brings the groups back exactly as they were when you saved the session.',
      },
      {
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
        good: 'Results update as you type. A plain search matches any tab whose title or URL contains that substring anywhere (not letters-in-order). A `group:`/`window:`/`tag:` prefix scopes the search and offers a picker for that prefix. Clicking any result closes search and jumps you straight to that result\'s group (and window, for a window result).',
      },
      {
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
        good: 'Review shows exactly which tabs are stale, and Remove stale asks for confirmation before deleting anything (if "confirm before delete" is on in Settings).',
        report: 'A group you deleted or archived reappears on its own — that\'s the "resurrection" bug we\'re specifically hunting.',
      },
      {
        steps: [
          'Right-click a saved tab and choose "Remind me…" (this is per-tab, not a Settings control).',
          'Set a reminder for a minute or two out and confirm.',
          'Wait for it to fire.',
        ],
        good: 'The tab shows a clock icon once a reminder is set, the right-click menu now offers "Edit reminder" and "Clear reminder" for it, and the reminder notification appears at roughly the time you set.',
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
        steps: [
          'Drag a tab down within the same window to move it later in the list, then drag it back up to its original spot.',
          'Drag a tab all the way to the first position in the window, then all the way to the last.',
        ],
        good: 'The tab lands exactly where you dropped it, the rest of the list shifts to make room, and no other tab moves or duplicates.',
      },
      {
        heading: 'Sorting: windows within a group',
        steps: ['In a group with two or more saved windows, drag a window card above or below another one.'],
        good: 'The window cards swap order and the new order is what you see immediately — no flicker back to the old order.',
      },
      {
        heading: 'Sorting: groups in the sidebar',
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
        good: '"Now Open" always stays pinned as the first row — you cannot drop a group above it, drag it, delete it, or reorder it away from the top. Every other group reorders freely.',
        report: 'Anything lands above "Now Open", or "Now Open" itself becomes draggable.',
      },

      // --- Cross-window ---
      {
        heading: 'Cross-window: moving a tab between window cards',
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
        good: 'The tab lands exactly at the position you dropped it (not just appended to the end), and both windows\' tab counts update immediately.',
      },

      // --- Cross-group ---
      {
        heading: 'Cross-group: dropping a tab onto a sidebar group',
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
        good: 'The tab is added to that group as a new window without needing to open the group first. If you paused over a non-active group, it should open ("spring open") after about half a second so you can see it land — and land correctly, not on the wrong window.',
        report: 'The group springs open but the tab lands in the wrong window, or on top of an existing tab instead of as its own new window.',
      },
      {
        heading: 'Cross-group: dragging a whole window into another group',
        steps: ['Drag an entire window card (using its own drag handle, not a single tab inside it) onto a different group in the sidebar.'],
        good: 'The whole window — with all its tabs — becomes a new window in the destination group. This works even if it\'s the last window left in the source group.',
        report: 'The source group or its emptied window disappears instead of staying (an empty window/group should stick around, not vanish).',
      },

      // --- Multi-item ---
      {
        heading: 'Multi-item: selecting and dragging several tabs',
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
          caption: 'Multiple tabs selected via Ctrl/Cmd-click.',
        },
        good: 'All selected tabs move together as one block, keeping their relative order — the block lands at the gap, not scattered or in click order.',
      },
      {
        heading: 'Multi-item: dragging a selection across windows and groups',
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
        good: 'The whole selection moves together in both cases, landing in the same relative order it started in.',
      },
      {
        heading: 'Multi-item: select all and multi-group drag',
        steps: [
          'Focus a window\'s tab list and press Ctrl+A (Cmd+A on Mac) to select every tab in that window, if your window has more than one tab.',
          'In the sidebar, Ctrl-click two or three groups to select them, then drag that selection by one of their grips to reorder them together.',
        ],
        good: 'Ctrl/Cmd+A selects every tab in the focused window (skipping any that are hidden by a search filter). The multi-group drag moves the selected groups together as one block, and the block never lands above "Now Open".',
        // TODO(screenshot): a multi-group sidebar selection mid-drag, once the demo agent has one.
      },

      // --- Drop zones ---
      {
        heading: 'Drop zones: "Drop here for a new window" and "Drop for a new group"',
        steps: [
          'Drag a tab (or a selection of tabs) toward the bottom of a group\'s window list, where the "Drop here for a new window" zone appears, and drop there.',
          'Drag a tab toward the bottom of the sidebar, where the "Drop for a new group" zone appears, and drop there.',
        ],
        good: 'Each drop creates a brand-new window or group holding exactly the dragged item(s), in their original relative order.',
        report: 'The "Drop for a new group" zone still appears once you\'re already at your plan\'s group limit — it should disappear instead of accepting a drop it can\'t fulfill.',
        // TODO(screenshot): both drop-zone affordances mid-hover, once available.
      },

      // --- From Now Open ---
      {
        heading: 'From "Now Open": dragging a live tab into a saved group',
        steps: [
          'Drag a tab from the "Now Open" section into one of your saved groups.',
          'Check your actual open browser tabs after the drop.',
        ],
        good: 'This MOVES the tab, not copies it: the saved group gets a new window containing a snapshot of that tab, and the real browser tab closes. If the tab you dragged was the active tab, it closes once you close the popup rather than immediately — that\'s intentional, not a bug.',
        report: 'The real tab stays open after the drop (making it look like a copy), or the popup itself closes/crashes mid-drag.',
      },

      // --- Cancel and edge cases ---
      {
        heading: 'Cancel and edge cases',
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
        good: 'Escape and an invalid/no-op drop leave everything exactly as it was — no duplicate tabs, no missing tabs, no reordering. Undo after a real drag restores the previous order exactly.',
        report: 'A tab is duplicated or goes missing after a cancelled or same-spot drag, or Undo doesn\'t fully restore the pre-drag order.',
      },

      // --- Keyboard drag ---
      {
        heading: 'Keyboard drag',
        steps: [
          'Focus a tab, window, or group row (Tab key, or click then Tab).',
          'Press Space to pick it up.',
          'Use the Arrow keys to move it, then press Space again to drop it — or press Escape instead to cancel.',
        ],
        good: 'You can reorder items with only a keyboard. Turn on a screen reader (or just listen for TabMerger\'s own announcements) and you should hear what picked up, where it moved, and where it landed at each step.',
      },

      // --- Persistence ---
      {
        heading: 'Persistence',
        steps: [
          'After reordering tabs, windows, or groups by drag, close the popup entirely and reopen it.',
          'If you have sync enabled and a second device signed in to the same account, check the order there too.',
        ],
        good: 'The new order is exactly as you left it after reopening the popup. With sync on, the second device picks up the same order within a short time.',
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
    id: 'web-app-and-dashboard',
    title: 'Web app and dashboard (preview site)',
    intro:
      'Everything here is at tabmerger-preview.vercel.app, not the main tabmerger.com — this beta build syncs with the preview site only.',
    items: [
      {
        heading: 'Signing up and signing in',
        steps: [
          'From a signed-out state, open tabmerger-preview.vercel.app/auth/sign-in.',
          'Try "Continue with Google".',
          'Try email + password instead: enter your email and password, then click "Continue".',
          'Try "Send magic link" instead, using just your email.',
        ],
        example: {
          kind: 'image',
          src: '/beta/sign-in.webp',
          width: 1600,
          height: 1200,
          alt: 'The TabMerger sign-in page with Google, email/password, and magic link options',
          caption: 'The sign-in page: Google, email/password, or a magic link.',
        },
        good: 'All three ways sign you in. The magic link and Google both redirect back into the app already signed in. New accounts land wherever "Sign up free" takes them (email + password or Google, same options).',
      },
      {
        heading: 'Forgot password and changing your password',
        steps: [
          'From sign-in, click "Forgot?" next to the password field and enter your email.',
          'Open the reset link from that email and set a new password (minimum 8 characters, and it must match its confirmation field).',
        ],
        good: 'You land back in the dashboard already signed in with the new password. Signing in again afterward requires the new password, not the old one.',
      },
      {
        heading: 'Dashboard matches the extension after sync',
        steps: [
          'With sync on and at least one group, open the dashboard at tabmerger-preview.vercel.app/dashboard.',
          'Compare the "Tab Groups" section there to the extension popup\'s sidebar: names, colors, window/tab counts and order.',
        ],
        good: 'The same groups appear with the same names, colors, and window/tab counts, in the same order, once sync has caught up.',
      },
      {
        heading: 'The dashboard is read-only for groups',
        steps: [
          'On the dashboard, look for any way to rename, delete, or create a group, or star/unstar one.',
          'Notice the "New group" button near the top of the dashboard.',
        ],
        good: 'There is no way to rename, delete, create, or (un)star a group from the dashboard — group edits are extension-only by design. "New group" is inert with a "Create groups from the extension" tooltip, not a working create flow. The only real actions on a group card are Share and opening its tabs/windows.',
        report: 'Any control on the dashboard that appears to edit, delete, or create a group actually does something.',
      },
      {
        heading: 'Sessions and stats on the dashboard',
        steps: [
          'Save a session in the extension, then check the dashboard\'s "Saved Sessions" section.',
          'Check the stats near the top of the dashboard (tab count, group count, session count, member-since date).',
        ],
        good: 'The session you saved shows up, and the stats match what you\'d count in the extension.',
      },
      {
        heading: 'Sharing from the dashboard',
        steps: [
          'On a group card (or via "Select" and "Share selected" for multiple groups), click Share.',
        ],
        good: 'A link is copied to your clipboard immediately, with a toast confirming it. This is covered in depth in the "Sharing" section below — the dashboard\'s Share button and the extension\'s produce the same kind of link.',
      },
      {
        heading: 'Account page',
        steps: [
          'Open Account settings from the dashboard.',
          'Check the Profile card (email, member since), the Subscription card (plan, "Manage billing" or "Upgrade"), and the Devices card.',
          'Try "Sign out" and separately "Sign out of all devices".',
        ],
        good: 'Profile and Subscription show accurate, current info (see the "Upgrading to Pro" section below for the Subscription card in detail). Devices lists your signed-in devices with rename/remove controls. Both sign-out buttons return you to a signed-out state; "all devices" additionally revokes every other active session. There is no account-deletion option on this page — that\'s expected, not a gap to report.',
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
        steps: ['Read this before starting checkout — the card details you need are below.'],
        example: {
          kind: 'testCards',
        },
        good: 'You never type a real card number into this flow.',
      },
      {
        heading: 'Upgrading from the extension',
        steps: [
          'Open the extension popup and use any "Upgrade to Pro" entry point — the header\'s upgrade button, the nag banner that appears as you approach the free limit, or an upgrade prompt shown when you hit a free-tier limit.',
          'This opens the beta web app\'s pricing page (tabmerger-preview.vercel.app/pricing) in a new browser tab. Sign in there with the same account you use in the extension.',
          'Choose the Pro plan, monthly or yearly, and continue to Stripe Checkout.',
          'Complete checkout with the test card above (or a decline/3D-Secure card, if you\'re testing that path), then return to the app.',
        ],
        good: 'Checkout completes and you land back in the web app with Pro shown. The extension\'s popup polls for your plan roughly every 30 seconds, so it should pick up Pro on its own shortly — reopening the popup also forces a fresh check if you don\'t want to wait.',
        report: `The extension still shows free-tier limits (${FREE_TIER_LIMITS.groups} groups / ${FREE_TIER_LIMITS.tabs} tabs / ${FREE_TIER_LIMITS.urlRules} URL rules) more than a couple of minutes after a successful checkout and a popup reopen.`,
      },
      {
        heading: 'Upgrading from the web account page',
        steps: [
          'Instead of going through the extension, sign in directly at tabmerger-preview.vercel.app and open Account settings.',
          'Under "Subscription," click "Upgrade" and complete checkout with the test card.',
        ],
        good: 'The Subscription card on the account page now shows Pro, with a "Manage billing" button in place of "Upgrade." The extension picks up the same Pro status (see the polling note above) — the web account page and the extension should never disagree about your plan.',
        report: 'The web account page and the extension popup show different plans (one says Pro, the other still says Free) more than a couple of minutes apart.',
      },
      {
        heading: 'Cancelling',
        steps: [
          'On the account page, with an active Pro subscription, click "Manage billing" to open Stripe\'s billing portal.',
          'Cancel the subscription from there and return to TabMerger.',
        ],
        good: 'You keep Pro access until the end of the current billing period — cancelling doesn\'t immediately drop you to Free. After that period ends, the account page and extension should both show Free again.',
        report: 'Cancelling drops you to Free immediately instead of at period end, or the plan never reverts to Free after the period actually ends.',
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
        steps: [
          'On a fresh sign-in with cloud sync, wait for the "Set up encryption" prompt to appear on its own (it\'s triggered by the first sync attempt).',
          'Read the prompt text, then enter a new passphrase and repeat it in "Confirm passphrase".',
          'Click "Set up encryption".',
        ],
        good: 'The prompt reads "Your synced group and tab data is end-to-end encrypted with a passphrase only you know. Choose one now — there is no way to recover your data if you forget it, it never leaves your device and TabMerger cannot reset it for you." The passphrase must be at least 8 characters with no spaces, and must match its confirmation — mismatches or a too-short passphrase show a clear inline error ("Passphrase must be at least 8 characters" / "Passphrases do not match" / "Passphrase cannot contain spaces") instead of silently failing. On success you see an "Encryption set up" toast and nothing you already synced is lost.',
      },
      {
        heading: 'Unlocking on a second device',
        steps: [
          'Sign in with the same account on a second device or browser profile.',
          'When the "Unlock encryption" prompt appears, enter your passphrase in both fields and click "Save".',
          'Repeat once more, but deliberately type the wrong passphrase.',
        ],
        good: 'The unlock prompt reads "Enter your encryption passphrase to unlock synced data on this device. This is a one-time step per device — you won\'t be asked again unless you sign out." The correct passphrase unlocks and shows an "Encryption passphrase set" toast. The wrong one shows "Wrong passphrase" and changes nothing else — no corruption, no lockout, you can just try again.',
      },
      {
        heading: 'What "locked" looks like, and staying unlocked after a restart',
        steps: [
          'While a device is locked (before you\'ve entered the passphrase there), try to use cloud sync features.',
          'Unlock it, then fully quit and reopen your browser (not just the popup) on that device.',
        ],
        good: 'While locked, you get re-prompted for the passphrase rather than silently syncing plaintext or losing data. Once unlocked, the key persists in the browser\'s local storage on that device — a full browser restart does not re-prompt you; only signing out clears it.',
      },
      {
        heading: 'Forgot your passphrase — resetting encryption',
        steps: [
          'In Settings → Account, find "Forgot your passphrase? Reset encryption" (only shown once you\'ve completed setup at least once).',
          'Do NOT use this on data you care about — it permanently discards access to everything encrypted under your current passphrase. Use a throwaway test account if you want to try it.',
          'If you do try it, confirm the reset dialog, then set a brand-new passphrase when the setup prompt reopens.',
        ],
        good: 'The confirmation dialog is clear before anything happens. After confirming, you see an "Encryption reset — set up a new passphrase" toast and the setup prompt reopens immediately so you can pick a new one and keep syncing.',
      },
      {
        heading: 'Verifying on the web dashboard',
        steps: [
          'Sign in to the dashboard (tabmerger-preview.vercel.app) with an account that has encryption set up.',
          'If prompted, enter your passphrase in the inline unlock card before any group content appears.',
        ],
        good: 'The dashboard asks for the passphrase separately from the extension — unlocking there is its own one-time-per-tab step, not shared with the extension\'s unlock. The prompt reads "Your groups are end-to-end encrypted. Enter your passphrase to view them here." A wrong passphrase shows "Incorrect passphrase." without crashing the page. Once unlocked, your real group names and tabs render normally; before unlocking (or with the wrong key), a group shows as "(locked)" instead of leaking any content.',
      },
      {
        heading: 'How to tell your data really is encrypted',
        steps: [
          'There\'s no explicit "Encrypted ✓" badge in the UI — the visible signal is indirect.',
          'On a device where you haven\'t unlocked yet (or the dashboard, before entering your passphrase there), notice that group names/content don\'t render until you unlock.',
        ],
        good: 'The absence of readable content before unlocking is the signal: a locked group renders as "(locked)" with no name/tabs shown, and the dashboard shows the passphrase card instead of your groups. If content were ever readable without unlocking, that would mean it isn\'t actually encrypted — report it immediately if you see that.',
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
        steps: [
          'Enter selection mode and check one or more groups in the sidebar (not tabs or windows — Share only appears for a group-type selection).',
          'Click "Share" in the selection bar at the bottom.',
        ],
        good: 'A link is copied to your clipboard right away, with a "Link copied to clipboard" toast. Selecting several groups at once shares all of them together as one link/bundle — you don\'t need to share them one at a time.',
      },
      {
        heading: 'Opening a shared link',
        steps: [
          'Open the copied link in a signed-out browser window (or a private/incognito window).',
          'Check the favicons and titles on each shared tab, and try "Open tab" / "Open all tabs" / "Open window" / "Open all windows".',
        ],
        good: 'The page loads with no sign-in required, labeled "Shared collection · read-only", and shows every group, window, and tab with their real favicons and titles. The open buttons open the right tab(s)/window(s) in new browser tabs.',
      },
      {
        heading: 'Page previews on the shared page',
        steps: [
          'On the shared page, find the "Show page previews" switch above the group list.',
          'Turn it on and confirm the dialog that appears.',
          'Hover a tab to see its preview image and description.',
        ],
        good: 'The switch is off by default. Turning it on requires confirming a dialog first (turning it back off needs no confirmation) — the dialog explains that hovering a tab sends that tab\'s address to TabMerger\'s preview service, and that it isn\'t linked to your account, logged, or stored. Once on, hovering a tab shows its image/description; a page with no image shows "No preview" instead of a broken image.',
      },
      {
        heading: 'Sharing a group with many windows',
        steps: ['Share a group that has several saved windows (not just one).'],
        good: 'The shared page shows every window in that group, each labeled "Window N" (and "Incognito" if it was one), with its own tabs and its own "Open tab(s)" control.',
      },
      {
        heading: 'Sharing from the web dashboard instead of the extension',
        steps: [
          'On the dashboard, click "Share" on a single group card, or check several groups and click "Share selected".',
        ],
        good: 'Both dashboard paths copy a link the same way the extension does ("Link copied — shares a snapshot of this group." or "Link copied! Share page is live." respectively), producing the same kind of shared page.',
      },
      {
        heading: 'Editing, re-sharing, revoking, and expiry — what\'s NOT possible',
        steps: [
          'Try to find any way to edit an existing share, or to revoke/delete/expire one, from either the extension or the dashboard.',
        ],
        good: 'There is currently no UI anywhere to edit, revoke, delete, or expire a share link once created — a share is a permanent, immutable snapshot from the moment it\'s made. Re-sharing the same group creates a brand-new, separate link rather than updating the old one; the old link keeps working and still shows the old snapshot. This is expected — don\'t report the absence of a revoke/edit/expiry control, just confirm it matches this description.',
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
        good: 'Theme changes the whole UI immediately and survives closing/reopening the popup. With "Confirm before deleting" on, deleting a group or window asks first; off, it deletes immediately. "Open tab on click" on: a single click opens the tab in the browser; off: single click just selects/expands it. "Auto-deduplicate on merge" removes the duplicate automatically when on.',
      },
      {
        heading: 'General tab — Show page images in previews',
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
        good: 'Off: the preview clearly says "Not enabled" with the note "Page images are off. Turn on in Settings." — the switch itself saves right away, no confirmation dialog. On: a real page image loads in the hover preview, or "No preview" if that page has none. The setting\'s own description links to the privacy policy\'s page-previews section.',
        report: 'The preview shows "No preview" (blank) instead of a real image with the setting on and a page that has one.',
      },
      {
        heading: 'General tab — Cloud sync, Stale tab threshold, URL rules',
        steps: [
          'With Pro, toggle "Cloud sync" (this control only appears once you have Pro).',
          'Change "Stale tab threshold" to a different value (7/14/30/60 days).',
          'Click "Manage" next to "URL rules" and add a rule assigning a URL pattern to a group.',
        ],
        good: 'Cloud sync only shows up for Pro accounts (Free never sees it). Changing the stale-tab threshold changes which tabs get the amber stale dot. URL rules opens a manager where you can add/edit/remove pattern-to-group rules, and a newly-opened tab matching a rule gets auto-assigned.',
      },
      {
        heading: 'Account tab — Plan, Renews, Email, Manage billing / Upgrade, Sign out',
        steps: [
          'Open the Account tab and check the Plan, Renews (if paid), and Email rows.',
          'Click "Upgrade to Pro" (Free) or "Manage billing" (Pro/Pro AI) — see "Upgrading to Pro" above for what happens next.',
          'Click "Sign out".',
        ],
        good: 'Plan shows "Free", "Pro ($3.99/mo)", or "Pro AI ($7.99/mo)" matching your real subscription; Renews only shows for a paid plan and gives the real renewal date; Email matches your signed-in account. "Manage billing" opens Stripe\'s billing portal in a new tab; on Free it\'s "Upgrade to Pro" instead, opening the pricing page. Sign out returns you to a signed-out state.',
      },
      {
        heading: 'Account tab — Forgot your passphrase? Reset encryption',
        steps: [
          'This link only appears if you\'ve completed encryption setup at least once (see the "End-to-end encryption passphrase" section above for the full flow — don\'t repeat that here, just confirm it\'s reachable from this tab).',
        ],
        good: 'The link is visible at the bottom of the Account tab once encryption is set up, and not before.',
      },
      {
        heading: 'Data tab — Export, Import, Clear all data',
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
        good: 'Export downloads a file named like "tabmerger-backup-2026-01-15.json" with an "exported successfully" toast. Import asks you to confirm the group count before importing, then shows "imported successfully". Re-importing your own export brings back every group with the same windows, tabs, order and colours. All three file types (TabMerger JSON, Bookmarks HTML, OneTab .txt) are accepted, detected by file extension. "Clear all data" wipes groups, sessions, and settings after you confirm — treat it as destructive and only try it on a throwaway profile.',
        report: 'A bad or empty file silently does nothing instead of showing an error toast like "Invalid file format" or "No groups found".',
      },
      {
        heading: 'Save vs Reset, and the "Unsaved changes" indicator',
        steps: [
          'On the General tab, change any setting (e.g. Theme) without clicking Save.',
          'Notice the "Unsaved changes" text and that "Save changes" is only enabled while something is actually different from what\'s saved.',
          'Click "Restore defaults" instead of Save, then close Settings without saving.',
          'Reopen Settings and check whether your change stuck.',
        ],
        good: '"Unsaved changes" appears next to "Save changes" whenever the draft differs from the last saved settings, and "Save changes" is disabled when there\'s nothing new to save. "Restore defaults" only resets the in-progress draft back to defaults — it does not save by itself. Closing Settings without clicking "Save changes" discards the draft; reopening shows the last actually-saved values, not your unsaved edit.',
        report: '"Save changes" stays enabled with no changes made, or a setting you changed but never saved persists after closing and reopening Settings anyway.',
      },
      {
        heading: 'The version badge',
        steps: ['Look at the Settings dialog title bar.'],
        good: 'A small badge next to the word "Settings" shows the real semver you should report in bug reports (e.g. "v3.1.0-beta.5") — this is covered in more detail in the "Join and install" section above.',
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
                          {item.heading && (
                            <p className="text-foreground font-semibold text-[13px] uppercase tracking-wide mb-2.5">
                              {item.heading}
                            </p>
                          )}
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
                                    quality={90}
                                    // Matches the content column's real max width (max-w-2xl =
                                    // 672px) so HiDPI screens request the 2× screenshot source
                                    // instead of Next's default-quality, softened downscale.
                                    sizes="(min-width: 1024px) 672px, 100vw"
                                    className="w-full h-auto"
                                  />
                                </div>
                              ) : item.example.kind === 'testCards' ? (
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
