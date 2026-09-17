/**
 * Pure, deterministic builder for realistic "saved group" seed data, used by the
 * manual drag-and-drop click-around tool (`seedDev.ts` — run via
 * `pnpm --filter @tabmerger/extension seed:dev`).
 *
 * Deliberately free of any Playwright / chrome / IndexedDB / Node imports so it can
 * be unit-tested in isolation (see `src/__tests__/unit/repro/seedData.test.ts`).
 * The only shared dependency is `tab()` from `../seed`, reused for the tab-object
 * shape (favicon + ogImage) instead of re-deriving it here.
 *
 * Invariant: this builder NEVER emits the permanent "Now Open" group (index 0).
 * It only produces the SAVED groups that sit after it — the runner is responsible
 * for preserving Now Open in IndexedDB.
 */
import { tab as makeTab } from '../seed';

export interface SeedConfig {
  /** Number of SAVED groups to build (excludes the permanent "Now Open" group). */
  groups: number;
  /**
   * Windows per group. With `vary` on this is the upper bound and the actual
   * per-group count cycles through `1..windowsPerGroup`.
   */
  windowsPerGroup: number;
  /**
   * Tabs per window. With `vary` on this is the upper bound and the actual
   * per-window count varies deterministically within `[min(3, N) .. N]`.
   */
  tabsPerWindow: number;
  /**
   * Deterministically vary per-group / per-window counts so the seed looks real
   * (some groups with 1 window, some with 3; windows with 3–8 tabs). Turn off for
   * exact, uniform counts — handy for assertions.
   */
  vary: boolean;
}

export const SEED_DEFAULTS: SeedConfig = {
  groups: 4,
  windowsPerGroup: 2,
  tabsPerWindow: 5,
  vary: true,
};

/** Hard clamps so a fat-fingered env var can't spawn 900 windows. */
export const SEED_LIMITS = {
  groups: [1, 12] as const,
  windowsPerGroup: [1, 5] as const,
  tabsPerWindow: [1, 12] as const,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function intEnv(
  raw: string | undefined,
  fallback: number,
  [lo, hi]: readonly [number, number]
): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : fallback;
}

const boolEnv = (raw: string | undefined, fallback: boolean): boolean =>
  raw == null || raw === '' ? fallback : !(raw === '0' || raw.toLowerCase() === 'false');

/**
 * Resolve the `SEED_*` env vars into a fully-populated, clamped {@link SeedConfig}.
 * Takes `env` explicitly (no `process.env` fallback) so this module stays free of
 * Node's `process` global — keeps it checkable under the extension's tsconfig.
 */
export function resolveSeedConfig(env: Record<string, string | undefined>): SeedConfig {
  return {
    groups: intEnv(env.SEED_GROUPS, SEED_DEFAULTS.groups, SEED_LIMITS.groups),
    windowsPerGroup: intEnv(env.SEED_WINDOWS, SEED_DEFAULTS.windowsPerGroup, SEED_LIMITS.windowsPerGroup),
    tabsPerWindow: intEnv(env.SEED_TABS, SEED_DEFAULTS.tabsPerWindow, SEED_LIMITS.tabsPerWindow),
    vary: boolEnv(env.SEED_VARY, SEED_DEFAULTS.vary),
  };
}

// ─── Content pools ───────────────────────────────────────────────────────────

const GROUP_NAMES = [
  'Work',
  'Reading List',
  'Research',
  'Side Project',
  'Shopping',
  'Travel Planning',
  'Learning',
  'Recipes',
  'Job Hunt',
  'Home Reno',
  'Finance',
  'Watch Later',
];

// rgba strings mirroring PRESET_COLORS in @tabmerger/shared (inlined to keep this
// module dependency-free for the Playwright runner + unit test).
const GROUP_COLORS = [
  'rgba(59, 130, 246, 1)', // blue
  'rgba(34, 197, 94, 1)', // green
  'rgba(249, 115, 22, 1)', // orange
  'rgba(168, 85, 247, 1)', // purple
  'rgba(236, 72, 153, 1)', // pink
  'rgba(20, 184, 166, 1)', // teal
  'rgba(234, 179, 8, 1)', // yellow
  'rgba(99, 102, 241, 1)', // indigo
  'rgba(239, 68, 68, 1)', // red
  'rgba(71, 85, 105, 1)', // slate
];

interface Site {
  title: string;
  url: string;
  domain: string;
}

const SITES: Site[] = [
  { title: 'GitHub · Build and ship software on a single, collaborative platform', url: 'https://github.com', domain: 'github.com' },
  { title: 'facebook/react: The library for web and native user interfaces', url: 'https://github.com/facebook/react', domain: 'github.com' },
  { title: 'microsoft/vscode · Issues', url: 'https://github.com/microsoft/vscode/issues', domain: 'github.com' },
  { title: 'Pull Request #4821 · vercel/next.js', url: 'https://github.com/vercel/next.js/pull/4821', domain: 'github.com' },
  { title: 'Array.prototype.reduce() - JavaScript | MDN', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce', domain: 'developer.mozilla.org' },
  { title: 'Using the Fetch API - Web APIs | MDN', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch', domain: 'developer.mozilla.org' },
  { title: 'CSS Grid Layout - CSS | MDN', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout', domain: 'developer.mozilla.org' },
  { title: 'javascript - How do I redirect to another webpage? - Stack Overflow', url: 'https://stackoverflow.com/questions/503093/how-do-i-redirect-to-another-webpage', domain: 'stackoverflow.com' },
  { title: 'git - How to undo the most recent local commits? - Stack Overflow', url: 'https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git', domain: 'stackoverflow.com' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com', domain: 'news.ycombinator.com' },
  { title: 'Show HN: I built a thing over the weekend | Hacker News', url: 'https://news.ycombinator.com/item?id=39284712', domain: 'news.ycombinator.com' },
  { title: 'lofi hip hop radio 📚 beats to relax/study to - YouTube', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', domain: 'youtube.com' },
  { title: 'The Birth & Death of JavaScript — Gary Bernhardt - YouTube', url: 'https://www.youtube.com/watch?v=D3EWgtVWByM', domain: 'youtube.com' },
  { title: 'The TypeScript Handbook: The Basics', url: 'https://www.typescriptlang.org/docs/handbook/2/basic-types.html', domain: 'typescriptlang.org' },
  { title: 'Tailwind CSS - Rapidly build modern websites without ever leaving your HTML', url: 'https://tailwindcss.com', domain: 'tailwindcss.com' },
  { title: 'Overview | TanStack Query Docs', url: 'https://tanstack.com/query/latest/docs/framework/react/overview', domain: 'tanstack.com' },
  { title: 'Getting Started | Vite', url: 'https://vitejs.dev/guide/', domain: 'vitejs.dev' },
  { title: 'Node.js — Documentation', url: 'https://nodejs.org/docs/latest/api/', domain: 'nodejs.org' },
  { title: 'PostgreSQL: Documentation: 16: 9.4. String Functions and Operators', url: 'https://www.postgresql.org/docs/current/functions-string.html', domain: 'postgresql.org' },
  { title: 'The Rust Programming Language - The Rust Book', url: 'https://doc.rust-lang.org/book/', domain: 'doc.rust-lang.org' },
  { title: 'A Complete Guide to Flexbox | CSS-Tricks', url: 'https://css-tricks.com/snippets/css/a-guide-to-flexbox/', domain: 'css-tricks.com' },
  { title: 'r/programming', url: 'https://www.reddit.com/r/programming/', domain: 'reddit.com' },
  { title: 'Notion – The all-in-one workspace for your notes, tasks, wikis, and databases', url: 'https://www.notion.so', domain: 'notion.so' },
  { title: 'Linear – Plan and build products', url: 'https://linear.app', domain: 'linear.app' },
  { title: 'Figma: The Collaborative Interface Design Tool', url: 'https://www.figma.com/files/recent', domain: 'figma.com' },
  { title: 'Inbox – name@example.com – Gmail', url: 'https://mail.google.com/mail/u/0/#inbox', domain: 'mail.google.com' },
  { title: 'AWS Management Console', url: 'https://console.aws.amazon.com/console/home', domain: 'aws.amazon.com' },
  { title: 'Stripe Dashboard', url: 'https://dashboard.stripe.com/test/dashboard', domain: 'stripe.com' },
];

const faviconFor = (domain: string): string =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

// ─── Output shape (compatible with helpers.ts `seedIdb` + shared `Group`) ─────

export interface SeedTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  ogImage?: string;
  savedAt?: number;
}
export interface SeedWindow {
  id: number;
  tabs: SeedTab[];
  incognito: boolean;
  focused: boolean;
}
export interface SeedSavedGroup {
  id: string;
  name: string;
  color: string;
  windows: SeedWindow[];
}

function windowCountFor(cfg: SeedConfig, groupIndex: number): number {
  if (!cfg.vary) return cfg.windowsPerGroup;
  return 1 + (groupIndex % cfg.windowsPerGroup);
}

function tabCountFor(cfg: SeedConfig, groupIndex: number, windowIndex: number): number {
  if (!cfg.vary) return cfg.tabsPerWindow;
  const lo = Math.min(3, cfg.tabsPerWindow);
  const span = cfg.tabsPerWindow - lo + 1;
  return lo + ((groupIndex * 2 + windowIndex * 3) % span);
}

/**
 * Build the array of SAVED groups (Now Open excluded) for the given config.
 * Deterministic: same config in → identical output (modulo `savedAt`, which is a
 * single `Date.now()` snapshot shared by every tab in one call).
 */
export function buildSeedGroups(partial: Partial<SeedConfig> = {}): SeedSavedGroup[] {
  const cfg: SeedConfig = { ...SEED_DEFAULTS, ...partial };
  const savedAt = Date.now();
  const out: SeedSavedGroup[] = [];
  let siteCursor = 0;

  for (let gi = 0; gi < cfg.groups; gi++) {
    const windows: SeedWindow[] = [];
    const wc = windowCountFor(cfg, gi);

    for (let wi = 0; wi < wc; wi++) {
      const tc = tabCountFor(cfg, gi, wi);
      const tabs: SeedTab[] = [];

      for (let ti = 0; ti < tc; ti++) {
        const site = SITES[siteCursor % SITES.length];
        siteCursor += 1;
        tabs.push({
          // Reuse ../seed's tab() for the { favIconUrl, ogImage } shape, then pin
          // every value so the builder stays deterministic (seed.ts's tab() uses a
          // mutable module counter for its random favicon/ogImage):
          //   - id:0            saved-tab sentinel (see useGroups.ts / dndMove.ts)
          //   - favIconUrl      real per-domain favicon
          //   - ogImage         stable per-domain preview image
          ...makeTab(0, site.title, site.url),
          id: 0,
          favIconUrl: faviconFor(site.domain),
          ogImage: `https://picsum.photos/seed/${site.domain}/400/225`,
          savedAt,
        });
      }

      windows.push({
        id: 9000 + gi * 10 + wi,
        tabs,
        incognito: false,
        focused: false,
      });
    }

    out.push({
      id: `seed-g${gi + 1}`,
      name: GROUP_NAMES[gi % GROUP_NAMES.length],
      color: GROUP_COLORS[gi % GROUP_COLORS.length],
      windows,
    });
  }

  return out;
}

/** Total tab count across a built seed — handy for logging / assertions. */
export function countSeedTabs(groups: SeedSavedGroup[]): number {
  return groups.reduce((g, grp) => g + grp.windows.reduce((w, win) => w + win.tabs.length, 0), 0);
}
