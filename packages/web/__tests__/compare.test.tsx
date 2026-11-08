/**
 * The `/compare` page: the data file (lib/comparison.ts), the table, the competitor picker, the
 * page and its inbound links. Catalog key parity across locales is covered by
 * i18n-catalogs.test.ts (it walks every messages/<locale>/ folder); this file only checks that
 * every locale ships the `compare` namespace and that the data file's keys exist in English.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRICING_TIERS, SUPPORTED_LOCALES, type AiAvailability } from '@tabmerger/shared'
import en from '@/messages/en'
import { ComparisonTable } from '@/components/compare/ComparisonTable'
import { Footer } from '@/components/layout/Footer'
import { FAQ } from '@/components/marketing/FAQ'
import FeaturesPage from '@/app/[locale]/(marketing)/features/page'
import ComparePage from '@/app/[locale]/(marketing)/compare/page'
import { LIST_PRICE_FORMAT } from '@/components/pricing/priceFormat'
import {
  COMPARISON_ROWS,
  COMPETITORS,
  COMPETITOR_IDS,
  LEGEND_STATES,
  PRODUCTS,
  ROW_GROUPS,
  comparisonRows,
  type Row,
} from '@/lib/comparison'

const compareCatalog = en.compare as unknown as {
  rows: Record<string, { label: string }>
  labels: Record<string, string>
  notes: Record<string, string>
  groups: Record<string, string>
  states: Record<string, string>
  legend: Record<string, string>
}

const AI_OFF: AiAvailability = { managed: false, byok: false, any: false }
const AI_OWN_KEY: AiAvailability = { managed: false, byok: true, any: true }
const AI_BOTH: AiAvailability = { managed: true, byok: true, any: true }

const PRO = PRICING_TIERS.find((tier) => tier.id === 'pro')!
const usd = (amount: number) => new Intl.NumberFormat('en', LIST_PRICE_FORMAT).format(amount)

// jsdom has no matchMedia; the picker reads it (default: a wide screen, so every column's option shows).
const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function stubWide(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => stubWide(true))

/** The `<td>`s of a data row, in column order (TabMerger first), found by the row's key. */
function cellsOf(rows: readonly Row[], key: string): HTMLElement[] {
  const index = rows.findIndex((row) => row.key === key)
  expect(index, `row ${key}`).toBeGreaterThanOrEqual(0)
  const rowHeader = screen.getAllByRole('rowheader')[index]
  return within(rowHeader.closest('tr') as HTMLElement).getAllByRole('cell')
}

/** Cell text with whitespace collapsed. */
const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('comparison data', () => {
  it('lists nine competitors, TabMerger first among the products, in COMPETITOR_IDS order', () => {
    expect(COMPETITOR_IDS).toHaveLength(9)
    expect(COMPETITORS.map((c) => c.id)).toEqual([...COMPETITOR_IDS])
    expect(PRODUCTS.map((p) => p.id)).toEqual(['tabmerger', ...COMPETITOR_IDS])
  })

  it('gives every row a cell for every product, and a legal state', () => {
    const states = new Set(['yes', 'paid', 'partial', 'no', 'unknown', 'info'])
    for (const row of COMPARISON_ROWS) {
      for (const product of PRODUCTS) {
        expect(states.has(row.cells[product.id]?.state), `${row.key}/${product.id}`).toBe(true)
      }
    }
  })

  it('has 38 rows, every one in a known group, and the groups appear in page order', () => {
    expect(COMPARISON_ROWS).toHaveLength(38)
    const order = COMPARISON_ROWS.map((row) => ROW_GROUPS.indexOf(row.group))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('shows the five verdict states in the legend ("info" has no legend entry)', () => {
    expect([...LEGEND_STATES]).toEqual(['yes', 'paid', 'partial', 'no', 'unknown'])
  })

  it('uses "Not stated" for anything not listed, and "No" for AI everywhere but Toby', () => {
    const noAccount = COMPARISON_ROWS.find((r) => r.key === 'noAccount')!
    expect(noAccount.cells.tabSessionManager.state).toBe('unknown')
    const aiDescribe = COMPARISON_ROWS.find((r) => r.key === 'aiDescribe')!
    for (const id of COMPETITOR_IDS) expect(aiDescribe.cells[id].state).toBe(id === 'toby' ? 'unknown' : 'no')
  })

  it('has every labelKey and noteKey, row label, group and state word in the English catalog', () => {
    for (const availability of [AI_OFF, AI_OWN_KEY, AI_BOTH]) {
      for (const row of comparisonRows(availability)) {
        expect(compareCatalog.rows[row.key]?.label, `rows.${row.key}.label`).toBeTruthy()
        for (const product of PRODUCTS) {
          const cell = row.cells[product.id]
          if (cell.labelKey) expect(compareCatalog.labels[cell.labelKey], `labels.${cell.labelKey}`).toBeTruthy()
          if (cell.noteKey) expect(compareCatalog.notes[cell.noteKey], `notes.${cell.noteKey}`).toBeTruthy()
        }
      }
    }
    for (const group of ROW_GROUPS) expect(compareCatalog.groups[group], `groups.${group}`).toBeTruthy()
    for (const state of LEGEND_STATES) {
      expect(compareCatalog.states[state], `states.${state}`).toBeTruthy()
      expect(compareCatalog.legend[state], `legend.${state}`).toBeTruthy()
    }
  })

  it.each(SUPPORTED_LOCALES)('%s ships a compare.json', (locale) => {
    expect(existsSync(join(__dirname, '..', 'messages', locale, 'compare.json'))).toBe(true)
  })

  it('derives the TabMerger price from PRICING_TIERS, not a literal', async () => {
    const paidFrom = COMPARISON_ROWS.find((r) => r.key === 'paidFrom')!
    expect(paidFrom.cells.tabmerger.prices).toEqual({ monthly: PRO.monthlyPrice, yearly: PRO.yearlyPrice })

    vi.resetModules()
    vi.doMock('@tabmerger/shared', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@tabmerger/shared')>()
      return {
        ...actual,
        PRICING_TIERS: actual.PRICING_TIERS.map((t) => (t.id === 'pro' ? { ...t, monthlyPrice: 9.99, yearlyPrice: 99.99 } : t)),
      }
    })
    try {
      const mod = await import('@/lib/comparison')
      const row = mod.comparisonRows().find((r) => r.key === 'paidFrom')!
      expect(row.cells.tabmerger.prices).toEqual({ monthly: 9.99, yearly: 99.99 })
    } finally {
      vi.doUnmock('@tabmerger/shared')
      vi.resetModules()
    }
  })
})

describe('ComparisonTable', () => {
  it('renders every row for TabMerger and all nine competitors, under its group headings', () => {
    render(<ComparisonTable />)
    expect(screen.getAllByRole('rowheader')).toHaveLength(COMPARISON_ROWS.length)
    for (const row of COMPARISON_ROWS) {
      expect(screen.getByRole('rowheader', { name: compareCatalog.rows[row.key].label })).toBeInTheDocument()
      expect(cellsOf(COMPARISON_ROWS, row.key)).toHaveLength(PRODUCTS.length)
    }
    for (const group of ROW_GROUPS) expect(screen.getByText(compareCatalog.groups[group])).toBeInTheDocument()
    // Ten product columns plus the visually hidden feature column.
    const heads = screen.getAllByRole('columnheader')
    for (const product of PRODUCTS) expect(heads.some((h) => h.textContent?.startsWith(product.name))).toBe(true)
  })

  it('gives every cell accessible text for its state, with icons hidden from assistive technology', () => {
    const { container } = render(<ComparisonTable />)
    for (const row of COMPARISON_ROWS) {
      const cells = cellsOf(COMPARISON_ROWS, row.key)
      PRODUCTS.forEach((product, i) => {
        const cell = row.cells[product.id]
        const text = textOf(cells[i])
        expect(text.length, `${row.key}/${product.id}`).toBeGreaterThan(0)
        if (cell.state === 'unknown') expect(text).toBe('Not stated')
        if (cell.state === 'paid') expect(text).toContain('on a paid plan')
        if (cell.state === 'partial') expect(text).toContain('(partly)')
        if (cell.state === 'no' && !cell.labelKey) expect(text.startsWith('No')).toBe(true)
        if (cell.state === 'yes' && !cell.labelKey) expect(text.startsWith('Yes')).toBe(true)
      })
    }
    const tbody = container.querySelector('tbody')!
    for (const svg of tbody.querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders a legend of the five states', () => {
    render(<ComparisonTable />)
    const legend = screen.getByRole('list', { name: 'Key' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual(
      expect.arrayContaining(['Yes', 'No', 'Not stated', 'Partly'])
    )
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5)
  })

  describe('prices', () => {
    it('shows TabMerger\'s paid price as "$X/mo · $Y/yr" from PRICING_TIERS', () => {
      render(<ComparisonTable />)
      expect(textOf(cellsOf(COMPARISON_ROWS, 'paidFrom')[0])).toContain(`${usd(PRO.monthlyPrice)}/mo · ${usd(PRO.yearlyPrice)}/yr`)
    })

    it('renders monthly+yearly, yearly only, monthly only and one-time competitor prices', () => {
      render(<ComparisonTable />)
      const cells = cellsOf(COMPARISON_ROWS, 'paidFrom')
      const at = (id: (typeof COMPETITOR_IDS)[number]) => textOf(cells[PRODUCTS.findIndex((p) => p.id === id)])
      expect(at('toby')).toContain('$6.00/mo · $54.00/yr')
      expect(at('onetab')).toContain('$39.99/yr')
      expect(at('onetab')).not.toContain('/mo')
      expect(at('workona')).toContain('$7.00/mo')
      expect(at('workona')).not.toContain('/yr')
      expect(at('tabsOutliner')).toContain('$15.00 once')
    })

    it('says "No paid plan" (not a price) for donation-funded tools', () => {
      render(<ComparisonTable />)
      const cells = cellsOf(COMPARISON_ROWS, 'paidFrom')
      const sessionBuddy = textOf(cells[PRODUCTS.findIndex((p) => p.id === 'sessionBuddy')])
      expect(sessionBuddy).not.toMatch(/\$/)
      expect(sessionBuddy).toContain('Donations')
    })
  })

  describe('AI rows follow AI_AVAILABILITY', () => {
    const AI_KEYS = ['aiAutoGroup', 'aiNames', 'aiDescribe', 'aiSummaries', 'aiSessions', 'aiOrganize']

    it('off: every TabMerger AI cell reads "Coming soon", including the own-key row', () => {
      const rows = comparisonRows(AI_OFF)
      render(<ComparisonTable rows={rows} />)
      for (const key of [...AI_KEYS, 'aiOwnKey']) {
        const text = textOf(cellsOf(rows, key)[0])
        expect(text, key).toContain('Coming soon')
        expect(text, key).not.toContain('Pro AI')
      }
    })

    it('own key only: "Pro AI" with "With your own API key" under it; the own-key row lists the providers', () => {
      const rows = comparisonRows(AI_OWN_KEY)
      render(<ComparisonTable rows={rows} />)
      for (const key of AI_KEYS) {
        const text = textOf(cellsOf(rows, key)[0])
        expect(text, key).toContain('Pro AI')
        expect(text, key).toContain('With your own API key')
        expect(text, key).not.toContain('Coming soon')
      }
      expect(textOf(cellsOf(rows, 'aiOwnKey')[0])).toContain('Anthropic, OpenAI or Gemini')
    })

    it('both options on: plain "Pro AI" with no own-key note on the feature rows', () => {
      const rows = comparisonRows(AI_BOTH)
      render(<ComparisonTable rows={rows} />)
      for (const key of AI_KEYS) {
        const text = textOf(cellsOf(rows, key)[0])
        expect(text, key).toContain('Pro AI')
        expect(text, key).not.toContain('With your own API key')
        expect(text, key).not.toContain('Coming soon')
      }
      expect(textOf(cellsOf(rows, 'aiOwnKey')[0])).toContain('Anthropic, OpenAI or Gemini')
    })

    it('never changes a competitor\'s AI cell', () => {
      for (const id of COMPETITOR_IDS) {
        const off = comparisonRows(AI_OFF).find((r) => r.key === 'aiAutoGroup')!.cells[id]
        const on = comparisonRows(AI_BOTH).find((r) => r.key === 'aiAutoGroup')!.cells[id]
        expect(on).toEqual(off)
      }
    })
  })
})

describe('CompetitorPicker (inside the table)', () => {
  const wrapper = (container: HTMLElement) => container.querySelector('[data-chosen]') as HTMLElement

  it('offers "All tools" plus the nine competitors from md up, and "All tools" is the default', async () => {
    stubWide(true)
    const user = userEvent.setup()
    render(<ComparisonTable />)
    const trigger = screen.getByRole('combobox', { name: 'Compare TabMerger with' })
    expect(trigger).toHaveTextContent('All tools')
    await user.click(trigger)
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All tools', ...COMPETITORS.map((c) => c.name)])
  })

  it('offers only the nine competitors below md, defaulting to OneTab', async () => {
    stubWide(false)
    const user = userEvent.setup()
    render(<ComparisonTable />)
    const trigger = screen.getByRole('combobox', { name: 'Compare TabMerger with' })
    expect(trigger).toHaveTextContent('OneTab')
    await user.click(trigger)
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(COMPETITORS.map((c) => c.name))
  })

  it('starts on "auto" (the breakpoint decides) and renders every column in the markup', () => {
    stubWide(true)
    const { container } = render(<ComparisonTable />)
    expect(wrapper(container)).toHaveAttribute('data-chosen', 'auto')
    expect(wrapper(container)).toHaveAttribute('data-compare-layout', 'auto')
    for (const id of COMPETITOR_IDS) expect(container.querySelectorAll(`th[data-col="${id}"]`)).toHaveLength(1)
  })

  it('picking a competitor stacks the layout and keeps only that competitor with TabMerger, and "All tools" restores auto', async () => {
    stubWide(true)
    const user = userEvent.setup()
    const { container } = render(<ComparisonTable />)

    await user.click(screen.getByRole('combobox', { name: 'Compare TabMerger with' }))
    await user.click(await screen.findByRole('option', { name: 'Toby' }))

    const box = wrapper(container)
    expect(box).toHaveAttribute('data-chosen', 'toby')
    expect(box).toHaveAttribute('data-compare-layout', 'stacked')
    expect(screen.getByRole('combobox', { name: 'Compare TabMerger with' })).toHaveTextContent('Toby')
    // The rule that hides every other competitor column is keyed on the chosen id.
    expect(box.className).toContain('[&[data-chosen=toby]_[data-col]:not([data-col=toby])]:hidden')
    // The sr-only caption names the visible pair.
    const caption = container.querySelector('[data-caption="toby"]')!
    expect(caption.textContent).toBe('TabMerger compared with Toby')
    expect(box.className).toContain('[&[data-chosen=toby]_[data-caption=toby]]:inline')

    await user.click(screen.getByRole('combobox', { name: 'Compare TabMerger with' }))
    await user.click(await screen.findByRole('option', { name: 'All tools' }))
    expect(box).toHaveAttribute('data-chosen', 'auto')
    expect(box).toHaveAttribute('data-compare-layout', 'auto')
  })

  it('names the whole set in the "all" caption', () => {
    stubWide(true)
    const { container } = render(<ComparisonTable />)
    const all = container.querySelector('[data-caption="all"]')!
    const plain = (all.textContent ?? '').replace(/[⁦-⁩]/g, '')
    expect(plain).toContain('TabMerger compared with OneTab, Session Buddy')
    expect(plain).toContain('and Tab Wrangler')
  })
})

describe('/compare page', () => {
  it('renders the heading, the hero lead with the competitor count, a <time> stamp and the table', async () => {
    render(await ComparePage())
    expect(screen.getByRole('heading', { level: 1, name: 'How TabMerger compares' })).toBeInTheDocument()
    expect(document.body.textContent).toContain('TabMerger and 9 other tab managers')
    const times = document.querySelectorAll('time[datetime="2026-11-05"]')
    expect(times.length).toBeGreaterThan(0)
    const scrollBox = screen.getAllByRole('region', { name: 'Feature by feature' }).find((el) => el.getAttribute('tabindex') === '0')
    expect(scrollBox).toBeDefined()
    expect(document.getElementById('compare-table')).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader')).toHaveLength(COMPARISON_ROWS.length)
  })

  it('links a source for every competitor, opening safely in a new tab', async () => {
    render(await ComparePage())
    const external = [...document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')]
    for (const c of COMPETITORS) {
      const link = external.find((a) => a.href === c.storeUrl)
      expect(link, c.name).toBeDefined()
      expect(link!.rel).toContain('noopener')
      expect(link!.rel).toContain('nofollow')
    }
  })

  it('never says TabMerger is open source, nor that Safari gets an older version', async () => {
    render(await ComparePage())
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/open[\s-]?source/i)
    expect(text).not.toMatch(/safari gets the older version/i)
    expect(text).not.toMatch(/older version/i)
    expect(JSON.stringify(en.compare)).not.toMatch(/open[\s-]?source|older version/i)
  })
})

describe('links to /compare', () => {
  it('the footer links to /compare', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute('href', '/compare')
  })

  it('/features links to /compare', async () => {
    render(await FeaturesPage())
    expect(screen.getByRole('link', { name: /how TabMerger compares/i })).toHaveAttribute('href', '/compare')
  })

  it('the FAQ links to /compare', () => {
    render(<FAQ />)
    expect(screen.getByRole('link', { name: /how TabMerger compares/i })).toHaveAttribute('href', '/compare')
  })
})

describe('code-like tokens stay left to right', () => {
  // `group:`, `t:`, `Ctrl/Cmd+K`, `.txt` are wrapped in <code> in every catalog and rendered as
  // <bdi dir="ltr">, so their punctuation can't flip in Arabic, Hebrew or Persian. The catalog
  // test already requires every locale to keep every tag of the English message.
  const catalog = (locale: string) =>
    JSON.parse(readFileSync(join(__dirname, '..', 'messages', locale, 'compare.json'), 'utf8')) as {
      notes: Record<string, string>
    }
  const withoutCode = (message: string) => message.replace(/<code>[^<]*<\/code>/g, '')

  it.each(['ar', 'he', 'fa'])('%s keeps each search filter and operator inside <code>', (locale) => {
    const { notes } = catalog(locale)
    for (const token of ['group:', 'window:', 'tag:']) expect(notes.searchFilters).toContain(`<code>${token}</code>`)
    for (const token of ['t:', 'u:']) expect(notes.searchOperators).toContain(`<code>${token}</code>`)
    expect(withoutCode(notes.searchFilters)).not.toMatch(/group:|window:|tag:/)
    expect(withoutCode(notes.searchOperators)).not.toMatch(/[tu]:/)
    expect(withoutCode(notes.shortcutsTabMerger)).not.toMatch(/Cmd\+K/)
  })

  it('renders <code> tokens as left-to-right isolates in the table', () => {
    render(<ComparisonTable />)
    const [tabMerger] = cellsOf(COMPARISON_ROWS, 'search')
    expect([...tabMerger.querySelectorAll('bdi[dir="ltr"]')].map((el) => el.textContent)).toEqual(['group:', 'window:', 'tag:'])
    const tabManagerPlus = cellsOf(COMPARISON_ROWS, 'search')[COMPETITOR_IDS.indexOf('tabManagerPlus') + 1]
    expect([...tabManagerPlus.querySelectorAll('bdi[dir="ltr"]')].map((el) => el.textContent)).toEqual(['t:', 'u:'])
  })
})
