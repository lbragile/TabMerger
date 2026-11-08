import { Fragment, type ReactNode } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Check, Contrast, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { listNames } from '@/lib/stores'
import { LIST_PRICE_FORMAT } from '@/components/pricing/priceFormat'
import {
  COMPARISON_ROWS,
  COMPETITORS,
  LEGEND_STATES,
  PRODUCTS,
  ROW_GROUPS,
  type Cell,
  type CellState,
  type Product,
  type Row,
} from '@/lib/comparison'
import { CompetitorPicker } from './CompetitorPicker'
import { CompareScrollBox } from './CompareScrollBox'
import { CompareSectionBar } from './CompareSectionBar'
import { COMPARE_RICH_TAGS } from './richText'

/** A translator that takes the data file's keys (checked against the catalog by a test). */
type LooseTranslator = (key: string, values?: Record<string, string | number>) => string
/** The same, for rich text (notes may wrap code-like tokens in `<code>`). */
type LooseRichTranslator = (key: string, values?: Record<string, unknown>) => ReactNode

/** Icon and colour of each state; `unknown` and `info` have no icon. */
const STATE_ICON: Partial<Record<CellState, typeof Check>> = {
  yes: Check,
  paid: Check,
  partial: Contrast,
  no: Minus,
}

const STATE_STYLE: Record<CellState, string> = {
  yes: 'text-ok',
  paid: 'text-ok',
  partial: 'text-foreground',
  no: 'text-muted-foreground font-normal',
  unknown: 'text-text3 font-normal italic',
  info: 'text-foreground',
}

/** The "Paid" pill beside a paid value and in the legend. */
function PaidPill({ label }: { label: string }) {
  return (
    <span aria-hidden="true" className="ms-1 inline-block bg-primary/12 px-1.5 py-px text-[0.6875rem] font-semibold not-italic text-primary">
      {label}
    </span>
  )
}

/** A state's icon, hidden from assistive technology (the text says the same). */
function StateIcon({ state, className }: { state: CellState; className?: string }) {
  const Icon = STATE_ICON[state]
  if (!Icon) return null
  return <Icon aria-hidden="true" strokeWidth={2.5} className={cn('h-3.5 w-3.5 shrink-0', className)} />
}

/** A cell's message arguments: its plain values, and its prices as list prices in the page's locale. */
function useCellValues() {
  const format = useFormatter()
  return (cell: Cell): Record<string, string | number> => ({
    ...cell.values,
    ...Object.fromEntries(
      Object.entries(cell.prices ?? {}).map(([key, amount]) => [key, format.number(amount as number, LIST_PRICE_FORMAT)])
    ),
  })
}

function CellValue({
  cell,
  t,
  rich,
  values,
}: {
  cell: Cell
  t: LooseTranslator
  rich: LooseRichTranslator
  values: Record<string, string | number>
}) {
  const label = cell.labelKey ? t(`labels.${cell.labelKey}`, values) : t(`states.${cell.state === 'info' ? 'unknown' : cell.state}`)
  return (
    <div className={cn('flex items-start gap-1.5 font-medium', STATE_STYLE[cell.state])}>
      <StateIcon state={cell.state} className="mt-[0.1875rem]" />
      <span className="min-w-0">
        <span className={cn(cell.state !== 'no' && cell.state !== 'unknown' && 'text-foreground')}>{label}</span>
        {cell.state === 'paid' && (
          <>
            <PaidPill label={t('states.paidPill')} />
            <span className="sr-only">{t('states.paidSr')}</span>
          </>
        )}
        {cell.state === 'partial' && <span className="sr-only">{t('states.partialSr')}</span>}
        {cell.noteKey && (
          <span className="mt-0.5 block text-[0.78125rem] font-normal not-italic leading-snug text-text3">
            {rich(`notes.${cell.noteKey}`, { ...values, ...COMPARE_RICH_TAGS })}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * The TabMerger column's tint (a primary wash) over an opaque background: its cells are pinned,
 * so other columns scroll under them. An inset shadow paints above the background and below the
 * text.
 */
const TABMERGER_TINT = 'bg-background shadow-[inset_0_0_0_100rem_hsl(var(--primary)/0.05)]'
const TABMERGER_HEADER_TINT = 'bg-background shadow-[inset_0_0_0_100rem_hsl(var(--primary)/0.08)]'

/**
 * "All tools": the TabMerger column sticks right after the sticky feature column (`w-48`, 12rem),
 * so it stays in view while the competitors scroll sideways. Stacked layouts don't pin it.
 */
const TABMERGER_PINNED = 'sticky inset-s-48 compare-stacked:static'

function ProductHeader({ product }: { product: Product }) {
  const isTabMerger = product.id === 'tabmerger'
  return (
    <th
      scope="col"
      data-col={isTabMerger ? undefined : product.id}
      data-product={isTabMerger ? 'tabmerger' : undefined}
      className={cn(
        // Table view: each header cell sticks to the top of the scroll box. Stacked: the whole
        // <thead> sticks instead (a cell can't stick outside its grid row).
        'sticky top-0 z-20 border-b border-border bg-background px-3.5 py-4 text-start align-top text-[0.9375rem] font-semibold',
        'compare-stacked:static compare-stacked:px-2 compare-stacked:py-3',
        // TabMerger's header cell is a corner: sticky to the top and to the inline start.
        isTabMerger && cn('z-30 border-t-[0.1875rem] border-t-primary', TABMERGER_PINNED, TABMERGER_HEADER_TINT)
      )}
    >
      {product.name}
      <span className="mt-0.5 block text-xs font-normal text-text3">{product.browsers.join(' · ')}</span>
    </th>
  )
}

/** The five states, explained: the table's sticky footer from md up, above the rows below md. */
function Legend({ t }: { t: LooseTranslator }) {
  return (
    <ul
      aria-label={t('legend.label')}
      className="sticky inset-s-3.5 inline-flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem] font-normal text-text2 compare-stacked:static"
    >
      {LEGEND_STATES.map((state) => (
        <li key={state} className={cn('inline-flex items-center gap-1.5', state === 'no' && 'text-muted-foreground', state === 'unknown' && 'italic text-text3')}>
          <StateIcon state={state} className={state === 'yes' || state === 'paid' ? 'text-ok' : undefined} />
          {state === 'paid' && <PaidPill label={t('states.paidPill')} />}
          {t(`legend.${state}`)}
        </li>
      ))}
    </ul>
  )
}

/**
 * The comparison itself: one `<table>` with TabMerger first (tinted, primary top border), the
 * rows under their group headings, and the legend in its `<tfoot>`.
 *
 * - "All tools" (md and up, nothing picked): a real table in its own scroll box. The product
 *   names stick to the top, the feature names to the inline start (columns are at least 10rem: 12rem + 10 × 10rem,
 *   so the box scrolls sideways), and the legend to the bottom.
 * - Two columns (phones, or one competitor picked): stacked rows, each feature's label on its
 *   own line above its two cells (the `compare-stacked:` variant). From md up the scroll box
 *   stays; below md there is none (it would trap touch scrolling), the product-name row sticks
 *   under the site's navbar (`h-16` in Navbar.tsx) and the legend sits above the rows.
 *
 * Every column is in the server HTML; `CompetitorPicker` only hides some, so the page is complete
 * without JavaScript. No ancestor may clip overflow (`overflow: hidden` breaks sticky; the body's
 * `overflow-x: clip` is fine).
 */
export function ComparisonTable({ rows = COMPARISON_ROWS }: { rows?: readonly Row[] }) {
  const compare = useTranslations('compare')
  const t = compare as unknown as LooseTranslator
  const rich = compare.rich as unknown as LooseRichTranslator
  const common = useTranslations('common')
  const cellValues = useCellValues()
  const colCount = PRODUCTS.length + 1
  // The section names, in page order: the group headings' words, for the section bar.
  const sections = ROW_GROUPS.map((group) => t(`groups.${group}`))
  const rowClass = 'compare-stacked:grid compare-stacked:grid-cols-2'

  return (
    <CompetitorPicker
      competitors={COMPETITORS.map(({ id, name }) => ({ id, name }))}
      label={t('table.pickerLegend')}
      allTools={t('table.allTools')}
    >
      <CompareScrollBox
        labelledBy="compare-table"
        labels={{
          previousTool: t('table.previousTool'),
          nextTool: t('table.nextTool'),
          previousSection: t('table.previousSection'),
          nextSection: t('table.nextSection'),
          sections,
          goToPreviousSection: sections.map((name) => t('table.goToPreviousSection', { name })),
          goToNextSection: sections.map((name) => t('table.goToNextSection', { name })),
          sectionOf: sections.map((_, i) => t('table.sectionOf', { current: i + 1, total: sections.length })),
        }}
      >
        <table className="w-full min-w-[112rem] table-fixed border-separate border-spacing-0 text-sm compare-stacked:flex compare-stacked:min-w-0 compare-stacked:flex-col">
          <caption className="sr-only">
            <span data-caption="all" className="max-md:hidden">
              {t('table.caption', { products: listNames(COMPETITORS.map((c) => c.name), common) })}
            </span>
            {COMPETITORS.map((c) => (
              <span key={c.id} data-caption={c.id} className="hidden">
                {t('table.captionPair', { product: c.name })}
              </span>
            ))}
          </caption>
          <thead className="top-16 md:top-0 compare-stacked:sticky compare-stacked:z-20 compare-stacked:block compare-stacked:bg-background">
            <tr className={rowClass}>
              <th scope="col" className="sticky inset-s-0 top-0 z-30 w-48 border-b border-border bg-background compare-stacked:hidden">
                <span className="sr-only">{t('table.feature')}</span>
              </th>
              {PRODUCTS.map((product) => (
                <ProductHeader key={product.id} product={product} />
              ))}
            </tr>
          </thead>
          <tbody className="compare-stacked:block">
            {ROW_GROUPS.map((group) => (
              <Fragment key={group}>
                <tr className={rowClass}>
                  <th
                    scope="colgroup"
                    colSpan={colCount}
                    className="border-b border-border px-3.5 pb-3 pt-6 text-start text-xs font-semibold uppercase text-text3 ltr:tracking-[0.06em] compare-stacked:col-span-full compare-stacked:px-2"
                  >
                    {/* Stays in view when the box scrolls sideways (the cell spans every column). */}
                    <span className="sticky inset-s-3.5 inline-block">{t(`groups.${group}`)}</span>
                  </th>
                </tr>
                {rows
                  .filter((row) => row.group === group)
                  .map((row) => (
                    <tr key={row.key} className={rowClass}>
                      <th
                        scope="row"
                        className="sticky inset-s-0 z-10 border-b border-line bg-background px-3.5 py-3 text-start align-top font-medium compare-stacked:static compare-stacked:col-span-full compare-stacked:border-b-0 compare-stacked:px-2 compare-stacked:pb-0.5 compare-stacked:pt-3.5"
                      >
                        {t(`rows.${row.key}.label`)}
                      </th>
                      {PRODUCTS.map((product) => {
                        const cell = row.cells[product.id]
                        return (
                          <td
                            key={product.id}
                            data-col={product.id === 'tabmerger' ? undefined : product.id}
                            className={cn(
                              'border-b border-line px-3.5 py-3 align-top compare-stacked:px-2 compare-stacked:pb-2.5 compare-stacked:pt-1.5',
                              product.id === 'tabmerger' && cn('z-10', TABMERGER_PINNED, TABMERGER_TINT)
                            )}
                          >
                            <CellValue cell={cell} t={t} rich={rich} values={cellValues(cell)} />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot className="compare-stacked:block max-md:-order-1 md:compare-stacked:sticky md:compare-stacked:bottom-0 md:compare-stacked:z-20">
            <tr className="compare-stacked:block">
              <td
                colSpan={colCount}
                className="sticky bottom-0 z-20 border-t border-border bg-background p-0 compare-stacked:static compare-stacked:block max-md:border-b max-md:border-t-0"
              >
                {/* The section bar (client, md and up, JavaScript only) sits right above the legend. */}
                <CompareSectionBar />
                <div className="px-3.5 py-3 compare-stacked:px-2">
                  <Legend t={t} />
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </CompareScrollBox>
    </CompetitorPicker>
  )
}
