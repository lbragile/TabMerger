import type { seedIdb } from './helpers';

/**
 * Seed data for the visual regression spec (`tests/visual.spec.ts`).
 *
 * Everything here is fixed: no counters, no random values, no `Date.now()`. Timestamps are
 * offsets from {@link FROZEN_NOW}, the instant the spec freezes the popup's clock at, so
 * "stale" markers and relative times come out the same on every run. Favicons are inline
 * `data:` images or absent (the built-in fallback icon), so nothing is fetched.
 */

type SeedGroup = Parameters<typeof seedIdb>[1][number];
type SeedWindow = NonNullable<SeedGroup['windows']>[number];
type SeedTab = SeedWindow['tabs'][number];

/** The instant the popup's clock is frozen at. In the past, so a faked session never looks expired. */
export const FROZEN_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

const DAY = 24 * 60 * 60 * 1000;
/** Saved two days before the frozen instant: well inside every "stale" threshold (7 to 60 days). */
const RECENT = FROZEN_NOW - 2 * DAY;
/** Saved 45 days before the frozen instant: stale at the default 30-day threshold. */
const STALE = FROZEN_NOW - 45 * DAY;

// The app's preset colours (PRESET_COLORS in src/lib/types.ts), by name.
const RED = 'rgba(239, 68, 68, 1)';
const ORANGE = 'rgba(249, 115, 22, 1)';
const YELLOW = 'rgba(234, 179, 8, 1)';
const GREEN = 'rgba(34, 197, 94, 1)';
const TEAL = 'rgba(20, 184, 166, 1)';
const BLUE = 'rgba(59, 130, 246, 1)';
const PURPLE = 'rgba(168, 85, 247, 1)';
const PINK = 'rgba(236, 72, 153, 1)';
const GREY = 'rgba(128, 128, 128, 1)';

/** A flat coloured disc as an inline favicon (`hex` without the `#`). */
function favicon(hex: string): string {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='8' fill='%23${hex}'/%3E%3C/svg%3E`;
}

/** A saved tab. Saved tabs always carry `id: 0` in the app; `icon` is a hex colour or omitted for the fallback icon. */
function tab(title: string, url: string, icon?: string, extra: Partial<SeedTab> = {}): SeedTab {
  return { id: 0, title, url, savedAt: RECENT, ...(icon ? { favIconUrl: favicon(icon) } : {}), ...extra };
}

function win(id: number, tabs: SeedTab[], extra: Partial<SeedWindow> = {}): SeedWindow {
  return { id, tabs, incognito: false, focused: false, ...extra };
}

/**
 * Now Open, seeded empty: the popup fills it from the real browser on load. In the test browser
 * that is one window holding one `about:blank` tab (the popup's own page is left out by the app).
 */
export const NOW_OPEN_LIVE: SeedGroup = {
  id: 'nowopen0001',
  name: 'Now Open',
  permanent: true,
  color: GREY,
  updatedAt: FROZEN_NOW,
  windows: [],
};

const WORK: SeedGroup = {
  id: 'visualwork1',
  name: 'Work',
  color: BLUE,
  starred: true,
  note: 'Close the sprint board tabs once the release is out.',
  updatedAt: RECENT,
  windows: [
    win(
      101,
      [
        tab('Sprint board', 'https://tracker.example.com/boards/42', 'ef4444'),
        tab('API docs: payments', 'https://docs.example.com/api/payments', '3b82f6', { note: 'Check the refund section' }),
        tab('Pull request 1287', 'https://code.example.com/tabmerger/pull/1287', '22c55e', { customTitle: 'Review: sync fix' }),
        tab('Quarterly planning notes', 'https://notes.example.com/planning/q1', undefined, { savedAt: STALE }),
      ],
      { name: 'Release week', starred: true }
    ),
    win(102, [
      tab('Design doc: sync engine', 'https://docs.example.com/design/sync-engine', 'a855f7'),
      tab('Team calendar', 'https://calendar.example.com/team', 'f97316'),
    ]),
  ],
};

const READING: SeedGroup = {
  id: 'visualread1',
  name: 'Reading list',
  color: GREEN,
  note: 'Long reads for the weekend.',
  updatedAt: RECENT,
  windows: [
    win(111, [
      tab('How browsers schedule work', 'https://blog.example.org/browser-scheduling', '14b8a6'),
      tab('A field guide to IndexedDB', 'https://blog.example.org/indexeddb-field-guide'),
      tab('Docs that people read', 'https://writing.example.org/docs-people-read', 'eab308'),
    ]),
  ],
};

const TRIP: SeedGroup = {
  id: 'visualtrip1',
  name: 'Trip planning',
  color: ORANGE,
  updatedAt: RECENT,
  windows: [
    win(121, [
      tab('Train timetable', 'https://rail.example.net/timetable', 'ec4899'),
      tab('City map', 'https://maps.example.net/city'),
    ]),
  ],
};

/** Now Open plus three saved groups: under the point where the free-plan banner appears (4 groups). */
export const POPULATED: SeedGroup[] = [NOW_OPEN_LIVE, WORK, READING, TRIP];
/** Index of the "Work" group in {@link POPULATED}. */
export const WORK_INDEX = 1;

/** A coloured group holding a starred incognito window, a plain incognito window and a normal one. */
export const INCOGNITO: SeedGroup[] = [
  NOW_OPEN_LIVE,
  {
    id: 'visualincog',
    name: 'Private research',
    color: PINK,
    updatedAt: RECENT,
    windows: [
      win(
        201,
        [
          tab('Gift ideas', 'https://shop.example.com/gifts', 'ec4899'),
          tab('Price comparison', 'https://compare.example.com/results', '3b82f6'),
        ],
        { incognito: true, starred: true, name: 'Starred incognito' }
      ),
      win(202, [tab('Surprise party venues', 'https://venues.example.com/search', 'f97316'), tab('Cake recipes', 'https://recipes.example.com/cake')], {
        incognito: true,
        name: 'Plain incognito',
      }),
      win(203, [tab('Public wiki page', 'https://wiki.example.org/page', '22c55e')], { name: 'Regular window' }),
    ],
  },
  TRIP,
];

const LONG_WORD = 'Supercalifragilisticexpialidocious'.repeat(4);
const LONG_URL = `https://a-very-long-subdomain-name.for-an-equally-long-domain.example.com/${'deeply/nested/path/segment/'.repeat(6)}index.html?query=${'value'.repeat(20)}#fragment`;

/** Very long names, titles, URLs and notes: overflow, truncation and the sidebar/header seam. */
export const LONG_CONTENT: SeedGroup[] = [
  NOW_OPEN_LIVE,
  {
    id: 'visuallong1',
    name: `A group name that keeps going well past the width of the sidebar ${LONG_WORD}`,
    color: PURPLE,
    starred: true,
    note: `A long note. ${'It has many words and no natural end. '.repeat(8)}`,
    updatedAt: RECENT,
    windows: [
      win(
        301,
        [
          tab(`A tab title with many separate words that does not fit on one line ${'and then some more words '.repeat(6)}`, LONG_URL, 'ef4444'),
          tab(LONG_WORD, `https://example.com/${LONG_WORD}`, '3b82f6'),
          tab('Short title, long custom title', 'https://example.com/custom', undefined, {
            customTitle: `A custom title that is also far too long for the row ${LONG_WORD}`,
            note: `A long tab note ${'with repeated filler text '.repeat(10)}`,
          }),
        ],
        { name: `A window name that is far longer than the header it sits in ${LONG_WORD}`, starred: true, note: 'Window note' }
      ),
      win(302, [tab('Short', 'https://example.com/short', '22c55e')], { incognito: true, name: `Incognito ${LONG_WORD}` }),
    ],
  },
  { ...READING, id: 'visuallong2', name: `${LONG_WORD} second group` },
];

/**
 * Seven saved groups for a free account: the plan allows five, so the last two rows are locked
 * and the "approaching the free limit" banner shows.
 */
export const OVER_FREE_LIMIT: SeedGroup[] = [
  NOW_OPEN_LIVE,
  WORK,
  READING,
  TRIP,
  ...(
    [
      ['Recipes', RED],
      ['Side project', TEAL],
      ['Locked: sixth group', YELLOW],
      ['Locked: seventh group', PURPLE],
    ] as const
  ).map(([name, color], i): SeedGroup => ({
    id: `visualfree${i}`,
    name,
    color,
    updatedAt: RECENT,
    windows: [win(400 + i, [tab(`${name} tab`, `https://example.com/free/${i}`)])],
  })),
];

/**
 * Three URL rules (the free plan's maximum, so "Add rule" is disabled), one with a very long
 * pattern. Every rule points at a seeded group: the app drops a rule whose group is gone.
 */
export const URL_RULES = [
  { id: 'rule000001', pattern: 'code.example.com/*', groupId: WORK.id, createdAt: RECENT },
  { id: 'rule000002', pattern: `*.a-very-long-subdomain.example.org/${'path/'.repeat(12)}*`, groupId: READING.id, createdAt: RECENT },
  { id: 'rule000003', pattern: 'maps.example.net/*', groupId: TRIP.id, createdAt: RECENT },
];
