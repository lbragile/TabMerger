# TabMerger — UI Design Brief

A complete view-by-view snapshot of the current UI for both the Chrome extension popup and the Next.js web app. Use this to design a modern, cohesive redesign of both surfaces.

| | |
|---|---|
| **Extension size** | 780 × 600 px (fixed) |
| **Extension framework** | WXT + React + Tailwind CSS v4 |
| **Web framework** | Next.js 16 + shadcn/ui |
| **Component library** | shadcn/ui (Radix primitives) |
| **Audience** | Power users, developers, researchers |

---

## Foundation

### Brand Tokens

Current tokens from `globals.css`. The redesign should evolve these while keeping cyan as the primary brand signal and orange as a secondary accent.

| Name | Hex | Role |
|---|---|---|
| Cyan | `#00B4CC` | Primary |
| Orange | `#F5921E` | Accent |
| Sidebar BG | `#1A1D27` | Extension sidebar |
| Sidebar Hover | `#13151E` | Extension sidebar hover |
| Light Ground | `#F8FAFC` | Web app background |
| Near-black | `#0E1117` | Dark ground |

> **Pain point:** The sidebar dark background and the windows panel light background create a high-contrast split that works but lacks refinement. The orange accent is underused — it currently only appears on destructive actions and one toggle. Both surfaces would benefit from a more intentional elevation system (background → surface → elevated) rather than the current binary dark/light split.

### Typography

Current font stack: **Inter** across all surfaces. Border radius: `0.4rem` (conservative). The extension uses no custom type scale — most text is 12–14px with Tailwind utilities.

| Role | Size / Weight | Example |
|---|---|---|
| Heading | 22px / 700 | Research Tabs · Morning |
| Subhead | 14px / 600 | Work Session — 14 tabs, 3 windows |
| Body | 13px / 400 | Drag tabs between groups to reorganize. |
| Label | 11px / 500 uppercase | Saved Groups · Archived · Sessions |
| Mono | 11px monospace | github.com/anthropics/claude |

> **Design direction needed:** The extension popup has no visual hierarchy between group names, window counts, and tab titles — everything is nearly the same size. A clear 3-level type scale (group name → window/tab count badge → url/secondary) would make the UI scannable at a glance. The web app similarly lacks a display face for marketing sections.

### Hard Constraints

**Extension popup:**
- Fixed at exactly **780 × 600 px** — no outer scrollbars. Content scrolls internally per panel.
- Two-panel layout is load-bearing: left sidebar ~200px, right windows panel ~580px.
- Tailwind CSS v4 — no PostCSS plugins for custom transforms.
- No external fonts or CDN resources in the extension popup (CSP).
- Chrome MV3 — no inline scripts, strict CSP.
- Dark sidebar is a user-facing feature, not just an aesthetic choice.

**Web app:**
- Next.js 16 App Router.
- shadcn/ui components — redesign should work within the component system, or propose replacements with justification.
- Supabase Auth — login/signup pages must maintain the auth callback flow.
- Responsive: marketing site down to 375px; dashboard down to 768px min.

---

## Extension Views

### Popup Overview (780 × 600 px)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HEADER  [logo] [search···············] [undo][redo][⚡][AI][☰][avatar] │
├──────────────┬──────────────────────────────────────────────────────────┤
│              │                                                          │
│  SIDEBAR     │   WINDOWS PANEL                                          │
│  ~200px      │   ~580px                                                 │
│  dark bg     │   light bg (adaptive)                                    │
│              │                                                          │
│  ▸ Now Open  │  [Group toolbar: merge · split · sort · import · share]  │
│    (cyan)    │                                                          │
│  ─────────   │  ┌─ Window 1 ──────────────────────────────────────────┐ │
│  ★ Starred   │  │  ☐ favicon  Tab title                    [·· ✕]    │ │
│  · Group A   │  │  ☐ favicon  Tab title                    [·· ✕]    │ │
│  · Group B   │  └─────────────────────────────────────────────────────┘ │
│  ─────────   │                                                          │
│  Saved       │  ┌─ Window 2 ──────────────────────────────────────────┐ │
│  · Group C   │  │  ☐ favicon  Tab title                    [·· ✕]    │ │
│  · Group D   │  └─────────────────────────────────────────────────────┘ │
│  ─────────   │                                                          │
│  ▸ Archived  │                                                          │
│  ▸ Sessions  │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

**Pain points:**
- Sidebar and windows panel feel like two separate apps — no shared visual language.
- Search field and action icons compete for attention at the same visual weight.

**Design ask:** Make the two panels feel like one coherent workspace. The sidebar should guide the eye to what's active, and the windows panel should feel like a focused work area — not a flat list dump. Explore reducing header icon clutter via grouping or progressive disclosure.

---

### Header Bar (780 × ~44 px)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [⬡ TM]  [🔍 Search groups and tabs···············]  [↩][↪][💾][✦][☰][👤] │
└────────────────────────────────────────────────────────────────────────┘
  └──┘     └────────────────────────────────┘           └───────────────┘
  logo              search (flex-grow)                  action cluster
```

**Elements:**
- **Logo** — hexagon icon + "TM" text. Currently small and understated.
- **Search** — filters both group names and tab titles live. Grows to fill space.
- **Undo / Redo** — icon buttons, 10-snapshot history.
- **Save session** — captures current state as a named session.
- **AI organize** — posts to /api/ai/organize, opens suggestion modal.
- **Selection mode** — toggles checkbox mode across tabs.
- **User avatar dropdown** — sign in/out, subscription badge.

**Pain points:**
- 7 icons in a row — no grouping, no visible tooltips in some states.
- No breadcrumb or active-group name shown in header for orientation.

**Design ask:** Group the icons logically (history | session | ai | user). Consider showing the active group name in the header as a wayfinding anchor. The AI button should feel premium — it's a core differentiator.

---

### Sidebar (~200 × 556 px, scrollable)

```
┌──────────────────┐
│ ▸ NOW OPEN       │  ← always index 0, permanent
│   ● 12 tabs      │
├──────────────────┤
│ ★ Work           │  ← starred, sorted first
│   ● 8 tabs       │
├──────────────────┤
│ + New Group      │
├──────────────────┤
│ · Research       │  ← saved group (active)
│ · Shopping       │
│ · Reading List   │
│ · News           │
├──────────────────┤
│ ▸ Archived (3)   │  ← collapsible section
│ ▸ Sessions (5)   │  ← collapsible section
└──────────────────┘
```

**Current state:**
- Each row: color swatch dot · name · (implicit tab count)
- Active group: subtle background + cyan left border
- Hover shows context menu trigger (⋯) on right
- Drag handle appears on hover for reordering
- Archived groups show window/tab count as badge

**Pain points:**
- Tab count not shown on non-archived saved groups.
- No visual distinction between group types beyond star icon.
- Color swatch is a 12px dot — underused as an organizational signal.

**Design ask:** Make the active group feel truly selected. Show tab counts on all groups. Consider making the color swatch a taller left-border accent (4px) instead of a dot — more distinctive at small size.

---

### Group Item Row (~196 × 36 px)

```
Normal:
┌─────────────────────────────────────┐
│ ⠿ ● Work                    ★  [⋯] │
└─────────────────────────────────────┘

Active:
┌─────────────────────────────────────┐
│▌⠿ ● Work                    ★  [⋯] │  ← cyan left border + bg tint
└─────────────────────────────────────┘

Archived:
┌─────────────────────────────────────┐
│ ⠿ ● Old Project  [2w·14t]      [⋯] │  ← stats badge
└─────────────────────────────────────┘

Context menu (hover ⋯):
┌──────────────────┐
│  Rename          │
│  Change color    │
│  Star / Unstar   │
│  Add note        │
│  Archive         │
│  ─────────────── │
│  Delete          │  ← destructive, red
└──────────────────┘
```

**Elements:** Drag handle (⠿), color swatch (12px circle), name (truncated), star toggle, context menu trigger. Archived groups show window × tab count badge.

**Pain points:**
- Drag handle and context menu both appear on hover — hard to target on narrow rows.
- No visual feedback for groups with a note attached.

---

### Windows Panel (~580 × 556 px, scrollable)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [⊞ Merge] [⊟ Split] [↕ Sort] [↓ Import] [↑ Export] [🔗 Share] [✦ AI] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ Window 1 ──────────────────────────────────────────────────────┐ │
│  │  [+ add tab]                               [rename] [✕ close]   │ │
│  ├─────────────────────────────────────────────────────────────────┤ │
│  │  ⠿  🌐 favicon  Tab Title ············  [preview thumb]  [⋯][✕] │ │
│  │  ⠿  🌐 favicon  Tab Title ············  [preview thumb]  [⋯][✕] │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─ Window 2 ──────────────────────────────────────────────────────┐ │
│  │  ⠿  🌐 favicon  Tab Title ············                   [⋯][✕] │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  [ + Add window ]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Current state:**
- Toolbar: Merge windows, Split by domain, Sort tabs, Import URL, Export, Share, AI organize
- Window cards use border + subtle background
- Tab rows ~32px: favicon (16px) + title + optional OG thumbnail on hover
- DnD: tabs draggable within/between windows; windows draggable between groups

**Pain points:**
- Toolbar has 7 actions — no visual hierarchy between primary and secondary.
- Window headers are minimal — hard to distinguish focused window.
- Tab preview thumbnails inconsistent (only show for some tabs).

**Design ask:** Differentiate primary actions (Share, AI organize) from secondary (Import/Export). Window headers should feel like distinct containers. Consider a hover state that expands the tab row to show preview + URL inline, rather than floating.

---

### Tab Row (~560 × 32–44 px)

```
Normal:
┌────────────────────────────────────────────────────────────────────┐
│  ⠿  🌐  Tab title (truncated at ~300px)               [⋯]  [✕]   │
└────────────────────────────────────────────────────────────────────┘

Hover (with OG preview):
┌────────────────────────────────────────────────────────────────────┐
│  ⠿  🌐  Tab title (truncated at ~300px)  [img]        [⋯]  [✕]   │
└────────────────────────────────────────────────────────────────────┘

Context menu (⋯):
┌─────────────────────┐
│  Open in browser    │
│  Edit title         │
│  Reset title        │  ← if custom title is set
│  Copy URL           │
│  Move to group →    │
│  ──────────────     │
│  Remove             │
└─────────────────────┘
```

**Elements:** Drag handle, favicon (16px, falls back to globe), title (customTitle if set, else page title, truncated), OG preview thumbnail on hover, context menu, close button.

**Pain points:**
- No URL shown below the title — hard to know where a tab points.
- Custom-title state is invisible — no indicator the title was manually renamed.

**Opportunity:** Showing the favicon domain as a secondary line would significantly help orientation.

---

### Settings Modal (~420px wide, dialog overlay)

**Three tabs: General · Account · Data**

```
┌───────────────────────────────────────────────────────┐
│  Settings                                       [✕]   │
├───────────────────────────────────────────────────────┤
│  [  General  ] [  Account  ] [    Data    ]           │
├───────────────────────────────────────────────────────┤
│  GENERAL TAB                                          │
│                                                       │
│  Theme                                [system  ▾]    │
│  ────────────────────────────────────────────────     │
│  Confirm tab removal          [○────]                 │
│  Confirm window removal       [────○]  (on by default)│
│  Open tab on click            [────○]  (on by default)│
│  Auto-deduplicate on merge    [○────]                 │
│  ────────────────────────────────────────────────     │
│  Stale tab threshold          [30 days  ▾]            │
├───────────────────────────────────────────────────────┤
│  ACCOUNT TAB                                          │
│                                                       │
│  ┌─ info card ─────────────────────────────────────┐  │
│  │  Plan       Pro ($3.99/mo)                      │  │
│  │  Email      user@example.com                    │  │
│  └─────────────────────────────────────────────────┘  │
│  [Manage billing]                                     │
│  [Cloud sync  ────○]    ← Pro only                    │
│  [Sign out]                                           │
│  (Free users see [Upgrade to Pro] instead)            │
├───────────────────────────────────────────────────────┤
│  DATA TAB                                             │
│                                                       │
│  Export data     [Export ↓]   (.json)                 │
│  Import data     [Import ↑]   (.json / .html / .txt)  │
│  ─────────────────────────────────────────────────    │
│  [Clear all data]   ← red destructive                 │
├───────────────────────────────────────────────────────┤
│  [Restore defaults]              [Save changes]       │
└───────────────────────────────────────────────────────┘
```

**Settings inventory:**

| Setting | Default | Tab |
|---|---|---|
| Theme | System | General |
| Confirm tab removal | Off | General |
| Confirm window removal | On | General |
| Open tab on click | On | General |
| Auto-deduplicate on merge | Off | General |
| Stale tab threshold | 30 days | General |
| Cloud sync | On (Pro only) | Account |

**Pain points:**
- Account info buried alongside data management — no separate screen.
- Settings rows lack descriptions on most items.
- No visual confirmation when settings are saved (only a toast).
- "Save changes" button only enabled when draft ≠ saved.

**Design ask:** Split Account into a prominent section. Settings rows need consistent label + description + control layout. The save/restore-defaults footer should be sticky if content scrolls.

---

### Status Banners (full-width, ~32px, conditional)

Appear between header and main panels. At most one shows at a time.

```
Past due (red):
┌────────────────────────────────────────────────────────────────────────┐
│  ⚠  Payment issue — update your card  (click → opens /account)        │
└────────────────────────────────────────────────────────────────────────┘

Cancellation pending (amber):
┌────────────────────────────────────────────────────────────────────────┐
│  ⚠  Your Pro plan ends on Aug 19, 2026                                │
└────────────────────────────────────────────────────────────────────────┘

Stale tabs cleanup (amber, only when stale count ≥ 5):
┌────────────────────────────────────────────────────────────────────────┐
│  🗑  You have 12 tabs saved over 30 days ago. Remove stale tabs?       │
│                                        [Review]  [Remove stale]  [✕]  │
└────────────────────────────────────────────────────────────────────────┘
```

**Pain points:**
- All three use similar amber styling — past-due (urgent) is not distinct enough from stale-cleanup (informational).
- No animation when banner appears/disappears — layout jumps.

**Design ask:** Three severity levels need three distinct visual treatments: critical (past-due: solid red, white text), warning (cancel-pending: amber border + tint), informational (cleanup: neutral with icon). Animate entrance/exit.

---

### Upgrade CTA — Free Tier Gates

```
Limit reached (groups):
┌─────────────────────────────────────────────────────────────────────┐
│  ✦  You've reached the 5-group limit on the Free plan.             │
│     Upgrade to Pro for unlimited groups and cloud sync.            │
│                                    [Upgrade — $3.99/mo]            │
└─────────────────────────────────────────────────────────────────────┘

AI gate (Free or Pro clicking AI Organize):
┌─────────────────────────────────────────────────────────────────────┐
│  ✦  AI organization requires Pro AI.                               │
│     Includes AI organize, smart naming, and tab summaries.         │
│                                    [Upgrade — $7.99/mo]            │
└─────────────────────────────────────────────────────────────────────┘
```

**Free limits:** 5 groups, 50 tabs, no cloud sync, no AI.

**Pain points:**
- Upgrade CTA looks like an error state — no positive framing of what they get.
- Clicking "Upgrade" opens a tab and closes the extension popup.

**Design ask:** Make upgrade prompts feel like an invitation, not a wall. The AI gate is the highest-value upsell moment — show a preview of what AI organize does. Use brand cyan for upgrade CTAs.

---

### Other Modals

**URL Auto-assign Rules:**
```
┌──────────────────────────────────┐
│  URL Auto-assign Rules      [✕]  │
│  Pattern        Group            │
│  *.github.com   Work       [✕]   │
│  docs.*         Research   [✕]   │
│  [+ Add rule]                    │
└──────────────────────────────────┘
```
Glob patterns match new tab URLs on open, auto-saving them to a chosen group. Pain point: no live preview of which current tabs would match.

**AI Suggestion Banner (inline, above windows panel):**
```
┌──────────────────────────────────┐
│ ✦  AI suggests 3 new groups      │
│    from your 24 open tabs.       │
│    [View suggestions]  [Dismiss] │
└──────────────────────────────────┘
```

**Selection Action Bar (fixed bottom, appears when ≥1 tab selected):**
```
┌──────────────────────────────────────────────────────────┐
│  3 selected   [Move to group ▾]  [Share]  [Remove]  [✕] │
└──────────────────────────────────────────────────────────┘
```
Pain point: bar overlaps the last tab row — needs bottom padding when active.

---

## Web App Views

### Landing Page — /(marketing)/

```
┌───────────────────────────────────────────────────────────────┐
│  [⬡ TabMerger]    Features  Pricing  Changelog      [Install] │
├───────────────────────────────────────────────────────────────┤
│              Hero section                                     │
│    "Stop drowning in browser tabs."                           │
│    [Install for Chrome]  [View demo]                          │
│    [interactive demo embed]                                   │
├───────────────────────────────────────────────────────────────┤
│  Reviews strip  ★★★★★ 4.8 · 2,400 users                       │
├───────────────────────────────────────────────────────────────┤
│  Features grid  3-column cards                                │
│  AI organize │ Cloud sync │ Session restore                   │
│  URL rules   │ Share tabs │ Import/export                     │
├───────────────────────────────────────────────────────────────┤
│  Testimonials  3 quote cards                                  │
├───────────────────────────────────────────────────────────────┤
│  FAQ  accordion                                               │
├───────────────────────────────────────────────────────────────┤
│  Footer  links · social · legal                               │
└───────────────────────────────────────────────────────────────┘
```

**Pain points:**
- Hero is text-heavy — no product screenshot above the fold.
- Features grid treats all 6 features as equal weight.

**Design ask:** The hero needs a product shot — annotated screenshot or live embed of the popup. Lead with 2–3 differentiators (AI organize, cloud sync, session restore), then secondary features. Tone: professional productivity tool for knowledge workers.

---

### Pricing Page

```
┌───────────────────────────────────────────────────────────────┐
│              Choose your plan                                 │
│          [Monthly] [Yearly -20%]                              │
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │  Free      │  │  Pro  ★    │  │  Pro + AI  │              │
│  │  $0        │  │  $4/mo     │  │  $8/mo     │              │
│  │  5 groups  │  │  Unlimited │  │  Unlimited │              │
│  │  50 tabs   │  │  Cloud sync│  │  + AI      │              │
│  │  [Get Free]│  │  [Upgrade] │  │  [Upgrade] │              │
│  └────────────┘  └────────────┘  └────────────┘              │
└───────────────────────────────────────────────────────────────┘
```

**Pain points:**
- All 3 cards are the same size — no visual emphasis on recommended tier.
- AI features don't feel premium enough in the comparison list.

**Design ask:** Make Pro the visual focal point (larger, slight elevation). An inline animation of AI organize next to the Pro AI card would increase conversion.

---

### Dashboard — /(app)/dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│ [⬡ TabMerger]                              [avatar] [Sign out] │
├────────────┬────────────────────────────────────────────────────┤
│  Dashboard │  Groups               [Select] [⊞ grid] [≡ list]  │
│  Sessions  │  ──────────────────────────────────────────────    │
│  Account   │                                                    │
│            │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│            │  │ Work     │  │ Research │  │ Shopping │         │
│            │  │ 2w · 8t  │  │ 1w · 5t  │  │ 1w · 3t  │         │
│            │  │ Synced 2h│  │ Synced 5m│  │ Synced 1d│         │
│            │  │ [Share]  │  │ [Share]  │  │ [Share]  │         │
│            │  └──────────┘  └──────────┘  └──────────┘         │
└────────────┴────────────────────────────────────────────────────┘
```

**Current state:**
- Grid or list view toggle (saved to localStorage)
- Group card: 1px color accent bar, name, window/tab count badges, sync timestamp
- Share button per card (Pro only)
- Multi-select mode (Pro) — checkbox per card, floating share bar at bottom
- Onboarding checklist — dismissible banner for new users

**Pain points:**
- Group color is only a 1px top bar and a 12px dot — underused.
- Clicking "Show tabs" causes a reflow, not a smooth reveal.

**Design ask:** Color should be the dominant visual identity of each card (bold left border or background wash). The tab expansion should be a smooth animated reveal. Tab/window counts should read instantly without parsing two separate badges.

---

### Sessions

```
┌────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Morning Research  ℹ   [3 groups] [5 windows] [24 tabs]  │  │
│  │  July 19, 2026 at 9:14 AM                                │  │
│  │  "Catching up on AI research and HN feed"                │  │
│  │                                      [Restore]  [🗑]     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  hover on ℹ → tooltip showing group names + tab counts         │
└────────────────────────────────────────────────────────────────┘
```

**Current state:**
- Session cards: name, full datetime, optional description, group/window/tab count badges
- ℹ icon → tooltip showing group names and per-group tab count
- Restore button opens all session tabs in new windows
- Delete removes from Supabase

**Pain points:**
- Tooltip is small — hard to scan what's in a session at a glance.
- No visual indicator of the groups or their colors.

**Design ask:** Replace the tooltip with a richer hover popover showing group names with color swatches and tab counts, plus first few tab titles per group. Sessions should feel like a true "snapshot", not a raw data dump.

---

### Account Page — /(app)/account

```
┌──────────────────────────────────────────────────────────────────┐
│  Subscription                                                    │
│  Pro Plan · $4/month                                             │
│  Next billing: August 19, 2026                                   │
│  [Manage billing]  [Cancel subscription]                         │
│                                                                  │
│  Account                                                         │
│  you@example.com                                                 │
│  Connected via Google                                            │
│  [Sign out]                                                      │
└──────────────────────────────────────────────────────────────────┘
```

**Pain points:**
- Very sparse — feels like an afterthought.
- No usage stats (groups synced, AI calls used, sessions saved).

**Design ask:** Add a usage summary: groups synced, tabs saved, sessions created, AI calls remaining. These reinforce the subscription's value. Layout should feel like a clean settings page with logical grouping.

---

### Share Page — /share/[slug] (public, no auth)

```
┌───────────────────────────────────────────────────────────────┐
│ [⬡ TabMerger]                              [Install extension]│
├───────────────────────────────────────────────────────────────┤
│  Shared by user@email.com                                     │
│  24 tabs across 3 groups                                      │
│                                                               │
│  ● Work                                                       │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  🌐  GitHub — anthropics/claude                       │   │
│  │  🌐  Notion — Project Roadmap                         │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ● Research                                                   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  🌐  Arxiv — Attention is All You Need                │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  Expires: August 19, 2026                                     │
└───────────────────────────────────────────────────────────────┘
```

**Current state:**
- Public, no login required. Indexed by slug. Expires at a set date.
- Groups with color dot + tab list with favicons. Links are http/https only (XSS-safe).
- "Install extension" CTA in nav.

**Pain points:**
- Looks like a plain list — no sense of the TabMerger product.
- Windows within groups are not visually distinct.

**Design ask:** This is the product's most public-facing page. Each group styled with its color, tabs in a clean card layout with favicons prominent. The "Install extension" CTA should feel like a natural discovery moment. Think: "beautifully organized reading list."

---

### Auth Pages

```
Sign in:
┌──────────────────────────────────┐
│    [⬡ TabMerger]                 │
│    Sign in to your account       │
│    [G  Continue with Google]     │
│    ──── or ────                  │
│    Email  [·················]    │
│    Password  [·············]     │
│    [Forgot password?]            │
│    [Sign in]                     │
│    No account? [Sign up]         │
└──────────────────────────────────┘
```

Google OAuth (primary) + email/password (secondary). Currently uses unstyled Supabase Auth UI.

**Pain points:**
- No brand presence — could be any SaaS product.

**Design ask:** Split layout — product screenshot/illustration left, auth form right. Brand color prominent. This is the conversion moment.

---

### Changelog — /changelog

```
v2.1.0  ·  July 2026
  [New]      Tab notes — add a private note to any tab
  [New]      AI Organize — auto-group by topic (Pro AI)
  [New]      Selection mode — multi-select for bulk ops
  [Improved] Chrome-native tab groups imported automatically
  [Fixed]    Now Open group vanished on rapid tab events

v2.0.1  ·  June 2026
  [New]      Context menu — right-click to send tab to group
  [New]      Session save & restore (Pro)
  [Improved] Cloud sync: last-write-wins per-tab
  ...
```

Change types: **New** (green badge), **Improved** (blue badge), **Fixed** (amber badge). Three releases: v2.0.0 (May), v2.0.1 (June), v2.1.0 (July).

**Pain points:**
- No per-version anchor links. No distinction between major and patch releases.

**Design ask:** Changelog as a product timeline. Major releases (v2.0.0) get a hero block with screenshot; patches stay compact. Each version should be linkable via `#v2-1-0`. Badge tags should be scannable at speed.

---

### Privacy Policy — /privacy

**Sections:**
1. What We Collect and Why (account info, tab data, payment, analytics)
2. What We Don't Do (no selling data, no ad networks)
3. Data Retention
4. Your Rights (access, correction, deletion)
5. Security (Supabase RLS, TLS, Stripe PCI)
6. Contact

Last updated: July 16, 2026.

Intro callout: *"TabMerger is an indie product. We collect only what we need. Questions? Contact us."*

**Pain points:**
- Pure prose, no sticky TOC, no section anchors.
- Visually identical to ToS.

**Design ask:** Make the plain-English intro callout the hero. Add a sticky sidebar TOC for navigation on wider screens. Sub-headings (ACCOUNT INFORMATION, TAB DATA) should be visually distinct from section numbers. Feel: trustworthy and indie, not corporate boilerplate.

---

### Terms of Service — /terms

**Sections:** Acceptance · Service Description · Accounts and Subscriptions · Acceptable Use · Intellectual Property · Disclaimer · Limitation of Liability · Termination · Changes · Governing Law (British Columbia, Canada) · Contact

Subscription tier limits explicitly called out in section 3.

**Pain points:**
- Same visual treatment as Privacy — no differentiation between the two pages.
- 11 sections, no in-page navigation.

**Design ask:** Mirror Privacy layout but with a distinct header treatment so users can tell the documents apart at a glance. Sticky TOC on wider screens. The subscription/billing section should be easily findable — consider a callout or anchor link from the pricing page.
