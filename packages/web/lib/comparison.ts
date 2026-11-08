import { AUTO_BACKUP_RETENTION_COUNT, FREE_TIER_LIMITS, PRICING_TIERS, SUPPORTED_LOCALES, type AiAvailability } from '@tabmerger/shared'
import { AI_AVAILABILITY } from '@/lib/aiFlag'
import { STORE_BROWSER, STORE_IDS, type StoreId } from '@/lib/stores'

/**
 * The `/compare` page's data: TabMerger next to the tab managers people most often switch from.
 *
 * Every competitor cell comes from that product's own website or store listing (Chrome Web Store,
 * or Firefox Add-ons for a Firefox-only add-on), checked on {@link COMPARISON_CHECKED_ON}.
 * `unknown` ("Not stated") means those pages don't say, never that the feature is missing; `no`
 * is used only where the product's own pages say so. Anything a row doesn't list for a
 * competitor is "Not stated" (`row()`), AI rows included.
 * Re-check every competitor and update the date in the same change as any edit here.
 * TabMerger's own numbers come from `@tabmerger/shared` so they can't drift from what is sold.
 *
 * Words live in `messages/<locale>/compare.json`: a row's label is `rows.<key>.label`, a cell's
 * value `labels.<labelKey>` (or the state's default word), its note `notes.<noteKey>`. Product and
 * browser names are not translated.
 */

/** The competitors, by user count (the dropdown's order and the table's column order). */
export const COMPETITOR_IDS = [
  'onetab',
  'sessionBuddy',
  'toby',
  'workona',
  'tabManagerPlus',
  'tabSessionManager',
  'tabsOutliner',
  'simpleTabGroups',
  'tabWrangler',
] as const

export type CompetitorId = (typeof COMPETITOR_IDS)[number]
export type ProductId = 'tabmerger' | CompetitorId

/**
 * How a cell reads: `yes` (check), `paid` (check + "Paid" pill), `partial` (half circle),
 * `no` (dash), `unknown` ("Not stated", no icon). `info` is a plain value with no verdict (a
 * price), so it has no icon and no legend entry.
 */
export type CellState = 'yes' | 'paid' | 'partial' | 'no' | 'unknown' | 'info'

/** The five verdict states, in legend order. */
export const LEGEND_STATES = ['yes', 'paid', 'partial', 'no', 'unknown'] as const satisfies readonly CellState[]

/** USD list prices: per month, the full yearly amount, or a one-time price. */
export interface CellPrices {
  monthly?: number
  yearly?: number
  once?: number
}

export interface Cell {
  state: CellState
  /** `labels.<labelKey>`; without one the cell shows its state's word ("Yes", "No", "Not stated"). */
  labelKey?: string
  /** `notes.<noteKey>`: a short line under the value ("Not on Safari"). */
  noteKey?: string
  /** Arguments for the label and note messages (counts). */
  values?: Record<string, number | string>
  /** Prices for the label (`{monthly}`, `{yearly}`, `{once}`), formatted as list prices in the page's locale. */
  prices?: CellPrices
}

/** The row groups (`groups.<group>` in the catalog), in page order: {@link ROW_GROUPS}. */
export type RowGroup = 'plans' | 'organizing' | 'finding' | 'saving' | 'sync' | 'sharing' | 'ai' | 'other'

export interface Row {
  /** `rows.<key>.label` in the catalog. */
  key: string
  group: RowGroup
  cells: Record<ProductId, Cell>
}

/** The day every competitor fact below was last checked against its source (ISO date). */
export const COMPARISON_CHECKED_ON = '2026-11-05'

/** How {@link COMPARISON_CHECKED_ON} is written ("Nov 5, 2026"); UTC, so it never shifts a day. */
export const COMPARISON_DATE_FORMAT = { dateStyle: 'medium', timeZone: 'UTC' } as const satisfies Intl.DateTimeFormatOptions

/** {@link COMPARISON_CHECKED_ON} as a Date (midnight UTC). */
export const COMPARISON_CHECKED_DATE = new Date(`${COMPARISON_CHECKED_ON}T00:00:00Z`)

export interface Product {
  id: ProductId
  /** The product's own name, untranslated. */
  name: string
  /** Browsers it installs on, by name (untranslated). */
  browsers: readonly string[]
}

export interface Competitor extends Product {
  id: CompetitorId
  /** Its official pages the facts come from (source links), when it has a site. */
  siteUrls?: readonly string[]
  /** Its store listing (a source link). */
  storeUrl: string
  /** Which store {@link storeUrl} is on (the link's label). */
  store: Extract<StoreId, 'chrome' | 'firefox'>
}

export const TABMERGER_PRODUCT: Product = {
  id: 'tabmerger',
  name: 'TabMerger',
  browsers: STORE_IDS.map((store) => STORE_BROWSER[store]),
}

const COMPETITOR_LIST: readonly Competitor[] = [
  {
    id: 'onetab',
    name: 'OneTab',
    browsers: ['Chrome', 'Firefox', 'Edge', 'Safari'],
    siteUrls: ['https://www.one-tab.com/', 'https://www.one-tab.com/sync'],
    storeUrl: 'https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall',
    store: 'chrome',
  },
  {
    id: 'sessionBuddy',
    name: 'Session Buddy',
    browsers: ['Chrome'],
    siteUrls: ['https://sessionbuddy.com/'],
    storeUrl: 'https://chromewebstore.google.com/detail/session-buddy-tab-bookmar/edacconmaakjimmfgnblocblbcdcpbko',
    store: 'chrome',
  },
  {
    id: 'toby',
    name: 'Toby',
    browsers: ['Chrome', 'Firefox', 'Edge'],
    siteUrls: ['https://www.gettoby.com/pricing'],
    storeUrl: 'https://chromewebstore.google.com/detail/toby-tab-manager-session/hddnkoipeenegfoeaoibdmnaalmgkpip',
    store: 'chrome',
  },
  {
    id: 'workona',
    name: 'Workona',
    browsers: ['Chrome', 'Firefox'],
    siteUrls: ['https://workona.com/pricing/'],
    storeUrl: 'https://chromewebstore.google.com/detail/tab-manager-by-workona/ailcmbgekjpnablpdkmaaccecekgdhlh',
    store: 'chrome',
  },
  {
    id: 'tabManagerPlus',
    name: 'Tab Manager Plus',
    browsers: ['Chrome', 'Firefox'],
    storeUrl: 'https://chromewebstore.google.com/detail/tab-manager-plus-for-chro/cnkdjjdmfiffagllbiiilooaoofcoeff',
    store: 'chrome',
  },
  {
    id: 'tabSessionManager',
    name: 'Tab Session Manager',
    browsers: ['Chrome', 'Firefox', 'Edge'],
    storeUrl: 'https://chromewebstore.google.com/detail/tab-session-manager/iaiomicjabeggjcfkbimgmglanimpnae',
    store: 'chrome',
  },
  {
    id: 'tabsOutliner',
    name: 'Tabs Outliner',
    browsers: ['Chrome'],
    siteUrls: ['https://tabsoutliner.com/'],
    storeUrl: 'https://chromewebstore.google.com/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl',
    store: 'chrome',
  },
  {
    id: 'simpleTabGroups',
    name: 'Simple Tab Groups',
    browsers: ['Firefox'],
    storeUrl: 'https://addons.mozilla.org/en-US/firefox/addon/simple-tab-groups/',
    store: 'firefox',
  },
  {
    id: 'tabWrangler',
    name: 'Tab Wrangler',
    browsers: ['Chrome', 'Firefox'],
    storeUrl: 'https://chromewebstore.google.com/detail/tab-wrangler/egnjhciaieeiiohknchakcodbpgjnchh',
    store: 'chrome',
  },
]

/** The competitors in {@link COMPETITOR_IDS} order. */
export const COMPETITORS: readonly Competitor[] = COMPETITOR_IDS.map((id) => COMPETITOR_LIST.find((c) => c.id === id)!)

/** TabMerger first, then the competitors: the table's column order. */
export const PRODUCTS: readonly Product[] = [TABMERGER_PRODUCT, ...COMPETITORS]

/** The competitor shown on phones until the visitor picks another (and the only one without JavaScript). */
export const DEFAULT_COMPETITOR: CompetitorId = 'onetab'

/** The order the row groups appear in. */
export const ROW_GROUPS: readonly RowGroup[] = ['plans', 'organizing', 'finding', 'saving', 'sync', 'sharing', 'ai', 'other']

/** "example.com/pricing" for a source link: the host without `www.` and the path without its trailing slash. */
export function displayUrl(url: string): string {
  const { hostname, pathname } = new URL(url)
  return hostname.replace(/^www\./, '') + pathname.replace(/\/+$/, '')
}

const PRO_TIER = PRICING_TIERS.find((tier) => tier.id === 'pro')!

/**
 * TabMerger's cell on an AI feature row, by which Pro AI options are live (the same rule
 * `/features` uses): off reads "Coming soon", the own-key option alone "Pro AI" with "With your
 * own API key" under it, both options plain "Pro AI" (the own-key row says the rest).
 */
export function tabMergerAiCell(availability: AiAvailability): Cell {
  if (!availability.any) return { state: 'partial', labelKey: 'comingSoon' }
  if (!availability.managed) return { state: 'paid', labelKey: 'proAi', noteKey: 'ownKeyOnly' }
  return { state: 'paid', labelKey: 'proAi' }
}

/** TabMerger's "Use your own AI key" cell: part of Pro AI whenever any AI option is live. */
export function tabMergerOwnKeyCell(availability: AiAvailability): Cell {
  if (!availability.any) return { state: 'partial', labelKey: 'comingSoon' }
  return { state: 'paid', labelKey: 'proAi', noteKey: 'aiProviders' }
}

const YES: Cell = { state: 'yes' }
const NO: Cell = { state: 'no' }
const NOT_STATED: Cell = { state: 'unknown' }
const NO_SYNC: Cell = { state: 'no', labelKey: 'noSync' }
const NO_PAID_PLAN_LISTED: Cell = { state: 'info', labelKey: 'noPaidPlan' }
const NO_PAID_PLAN_DONATIONS: Cell = { state: 'info', labelKey: 'noPaidPlanAtAll', noteKey: 'donations' }

/**
 * A row: TabMerger's cell and the competitors' cells. A competitor left out is "Not stated", on
 * every row, AI included: silence on a product's own pages never becomes "No".
 */
function row(key: string, group: RowGroup, tabmerger: Cell, competitors: Partial<Record<CompetitorId, Cell>> = {}): Row {
  const cells = { tabmerger } as Record<ProductId, Cell>
  for (const id of COMPETITOR_IDS) cells[id] = competitors[id] ?? NOT_STATED
  return { key, group, cells }
}

/** The comparison rows, built for the given AI availability (the live flags by default). */
export function comparisonRows(availability: AiAvailability = AI_AVAILABILITY): Row[] {
  const ai = tabMergerAiCell(availability)
  return [
    // Plans
    row('free', 'plans', { state: 'yes', noteKey: 'freeLimits', values: { groups: FREE_TIER_LIMITS.groups, tabs: FREE_TIER_LIMITS.tabs } }, {
      onetab: YES,
      sessionBuddy: { state: 'yes', noteKey: 'everyFeature' },
      toby: { state: 'yes', noteKey: 'savedTabsLimit', values: { count: 60 } },
      workona: { state: 'yes', noteKey: 'upToSpaces', values: { count: 5 } },
      tabManagerPlus: YES,
      tabSessionManager: YES,
      tabsOutliner: { state: 'yes', noteKey: 'noLimits' },
      simpleTabGroups: YES,
      tabWrangler: YES,
    }),
    row(
      'paidFrom',
      'plans',
      { state: 'info', labelKey: 'priceMonthlyYearly', noteKey: 'proIncludes', prices: { monthly: PRO_TIER.monthlyPrice, yearly: PRO_TIER.yearlyPrice } },
      {
        onetab: { state: 'info', labelKey: 'priceYearly', noteKey: 'backupSyncYearly', prices: { yearly: 39.99 } },
        sessionBuddy: NO_PAID_PLAN_DONATIONS,
        toby: { state: 'info', labelKey: 'priceMonthlyYearly', prices: { monthly: 6, yearly: 54 } },
        workona: { state: 'info', labelKey: 'priceMonthly', noteKey: 'startingAtNoYearly', prices: { monthly: 7 } },
        tabManagerPlus: NO_PAID_PLAN_DONATIONS,
        tabSessionManager: NO_PAID_PLAN_DONATIONS,
        tabsOutliner: { state: 'info', labelKey: 'priceOnce', noteKey: 'proPlan', prices: { once: 15 } },
        simpleTabGroups: NO_PAID_PLAN_LISTED,
        tabWrangler: NO_PAID_PLAN_LISTED,
      }
    ),
    row('noAccount', 'plans', { state: 'yes', noteKey: 'accountForSyncAi' }, {
      onetab: YES,
      sessionBuddy: YES,
      toby: { state: 'partial', labelKey: 'syncNeedsSignIn' },
      workona: NO,
      tabManagerPlus: YES,
      tabsOutliner: YES,
    }),
    // Organizing
    row('groups', 'organizing', { state: 'yes', noteKey: 'namedColorCoded' }, {
      onetab: { state: 'partial', labelKey: 'folders', noteKey: 'notOnSafari' },
      sessionBuddy: { state: 'yes', labelKey: 'collections', noteKey: 'colorCoded' },
      toby: { state: 'yes', labelKey: 'collectionsAndSpaces' },
      workona: { state: 'yes', labelKey: 'spaces' },
      tabManagerPlus: { state: 'partial', labelKey: 'namedColoredWindows' },
      tabSessionManager: { state: 'partial', labelKey: 'namedTaggedSessions' },
      tabsOutliner: { state: 'partial', labelKey: 'windowTree' },
      simpleTabGroups: YES,
    }),
    row('windows', 'organizing', YES),
    row('dnd', 'organizing', { state: 'yes', noteKey: 'mouseKeyboard' }, { tabManagerPlus: YES, tabsOutliner: YES }),
    row('shortcuts', 'organizing', { state: 'yes', noteKey: 'shortcutsTabMerger' }, {
      onetab: YES,
      sessionBuddy: { state: 'yes', noteKey: 'customizable' },
      tabsOutliner: { state: 'paid' },
      simpleTabGroups: YES,
    }),
    row('contextMenu', 'organizing', YES),
    row('customTitles', 'organizing', YES),
    row('notes', 'organizing', YES, { onetab: YES, toby: YES, tabsOutliner: YES }),
    row('reminders', 'organizing', YES),
    row('urlRules', 'organizing', { state: 'yes', noteKey: 'urlRulesLimits', values: { count: FREE_TIER_LIMITS.urlRules } }),
    row('bulk', 'organizing', { state: 'yes', noteKey: 'bulkActions' }),
    // Finding & cleanup
    row('search', 'finding', { state: 'yes', noteKey: 'searchFilters' }, {
      onetab: { state: 'partial', noteKey: 'notOnSafari' },
      sessionBuddy: { state: 'yes', noteKey: 'openSavedHistory' },
      toby: { state: 'yes', noteKey: 'advancedSearchPaid' },
      workona: YES,
      tabManagerPlus: { state: 'yes', noteKey: 'searchOperators' },
      simpleTabGroups: YES,
      tabWrangler: { state: 'partial', labelKey: 'searchesClosedTabs' },
    }),
    row('duplicates', 'finding', YES, {
      onetab: YES,
      sessionBuddy: { state: 'yes', labelKey: 'detectsDuplicateBookmarks' },
      toby: { state: 'paid' },
    }),
    row('staleTabs', 'finding', YES),
    row('memory', 'finding', YES, {
      onetab: { state: 'yes', labelKey: 'coreFeature' },
      sessionBuddy: YES,
      workona: { state: 'yes', labelKey: 'tabSuspension' },
      tabsOutliner: { state: 'yes', noteKey: 'closeWindowsKeepTree' },
      tabWrangler: { state: 'yes', labelKey: 'closesIdleTabs', noteKey: 'reopenFromCorral' },
    }),
    // Saving & restoring
    row('sessions', 'saving', { state: 'yes', noteKey: 'sessionsLimits', values: { count: FREE_TIER_LIMITS.sessions } }, {
      onetab: { state: 'partial', labelKey: 'listsSurviveRestarts' },
      sessionBuddy: { state: 'yes', labelKey: 'coreFeature', noteKey: 'historySnapshots' },
      toby: { state: 'yes', labelKey: 'saveWindows' },
      workona: { state: 'yes', labelKey: 'autosave' },
      tabManagerPlus: { state: 'yes', labelKey: 'saveRestoreWindows' },
      tabSessionManager: { state: 'yes', noteKey: 'autoSavesOnCloseTimer' },
      tabsOutliner: { state: 'yes', labelKey: 'crashRecovery' },
    }),
    row('continueOnDevice', 'saving', { state: 'paid', labelKey: 'pro' }),
    row('backups', 'saving', { state: 'paid', labelKey: 'pro', noteKey: 'newestKept', values: { count: AUTO_BACKUP_RETENTION_COUNT } }, {
      onetab: { state: 'yes', noteKey: 'weeklyLocalBackup' },
      sessionBuddy: { state: 'yes', noteKey: 'plusManualBackups' },
      workona: { state: 'paid', labelKey: 'pro', noteKey: 'sessionBackups' },
      tabsOutliner: { state: 'paid', noteKey: 'backupsGoogleDrive' },
      simpleTabGroups: { state: 'yes', noteKey: 'toJsonFile' },
    }),
    // Sync & safety
    row('sync', 'sync', { state: 'paid', labelKey: 'pro' }, {
      onetab: { state: 'paid', labelKey: 'backupSync', noteKey: 'notOnSafari' },
      sessionBuddy: { state: 'no', noteKey: 'dataStaysLocal' },
      toby: YES,
      workona: YES,
      tabManagerPlus: { state: 'no', noteKey: 'offlineThisBrowser' },
      tabSessionManager: { state: 'yes', labelKey: 'cloudSync' },
      tabsOutliner: { state: 'partial', labelKey: 'viaGoogleDrive', noteKey: 'proPlan' },
      simpleTabGroups: { state: 'no', noteKey: 'groupsSavedLocally' },
      tabWrangler: { state: 'partial', labelKey: 'settingsOnly', noteKey: 'closedTabsNotSynced' },
    }),
    row('e2ee', 'sync', { state: 'yes', labelKey: 'alwaysOn' }, {
      onetab: { state: 'paid', labelKey: 'withBackupSync' },
      sessionBuddy: NO_SYNC,
      tabManagerPlus: NO_SYNC,
      simpleTabGroups: NO_SYNC,
    }),
    row('dashboard', 'sync', { state: 'paid', labelKey: 'pro', noteKey: 'dashboardView' }),
    // Sharing & moving
    row('share', 'sharing', { state: 'yes', noteKey: 'encrypted' }, {
      onetab: { state: 'yes', labelKey: 'asWebPage' },
      sessionBuddy: { state: 'partial', labelKey: 'copyAsLinks' },
      toby: { state: 'yes', labelKey: 'shareCollections' },
      workona: { state: 'paid', labelKey: 'team', noteKey: 'sharedSpaces' },
    }),
    row('import', 'sharing', { state: 'yes', noteKey: 'importFormats' }, {
      onetab: { state: 'yes', noteKey: 'importExportLists' },
      sessionBuddy: { state: 'yes', noteKey: 'manyFormats' },
      tabManagerPlus: { state: 'yes', noteKey: 'savedWindowsFiles' },
      tabSessionManager: { state: 'yes', noteKey: 'fromSessionBuddy' },
      tabsOutliner: YES,
      simpleTabGroups: { state: 'yes', noteKey: 'stgImportSources' },
    }),
    row('export', 'sharing', { state: 'yes', noteKey: 'json' }, {
      onetab: YES,
      sessionBuddy: { state: 'yes', noteKey: 'manyFormats' },
      tabManagerPlus: { state: 'yes', noteKey: 'savedWindowsFiles' },
      tabSessionManager: YES,
      tabsOutliner: { state: 'yes', noteKey: 'textOutlineHtml' },
      simpleTabGroups: { state: 'yes', noteKey: 'json' },
    }),
    // AI (Pro AI)
    row('aiAutoGroup', 'ai', ai, { toby: { state: 'paid', labelKey: 'smartFeatures', noteKey: 'optIn' } }),
    row('aiNames', 'ai', ai, { toby: { state: 'paid', labelKey: 'smartFeatures' } }),
    row('aiDescribe', 'ai', ai),
    row('aiSummaries', 'ai', ai),
    row('aiSessions', 'ai', ai),
    row('aiOrganize', 'ai', ai),
    row('aiOwnKey', 'ai', tabMergerOwnKeyCell(availability)),
    // Everything else
    row('languages', 'other', { state: 'yes', labelKey: 'languageCount', noteKey: 'rtlIncluded', values: { count: SUPPORTED_LOCALES.length } }, {
      // OneTab's extension ships 54 locales (more than TabMerger; shown as is).
      onetab: { state: 'yes', labelKey: 'languageCount', values: { count: 54 } },
    }),
    row('theme', 'other', YES, { onetab: YES, sessionBuddy: YES, toby: { state: 'yes', noteKey: 'themesPalettes' } }),
    row('tour', 'other', YES),
  ]
}

/** The rows for this deployment's AI flags. */
export const COMPARISON_ROWS: readonly Row[] = comparisonRows()
