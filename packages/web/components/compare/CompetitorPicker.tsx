'use client'

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DEFAULT_COMPETITOR, type CompetitorId } from '@/lib/comparison'

/**
 * What the wrapper shows: `auto` (no pick yet, or "All tools") lets the breakpoint decide, every
 * competitor from `md` up and only {@link DEFAULT_COMPETITOR} below it, which is also what the
 * server HTML shows without JavaScript; a competitor id shows only that one, at every width.
 */
type Shown = CompetitorId | 'auto'

/**
 * One rule per state, written out so Tailwind sees each class; the wrapper's `data-chosen`
 * decides which apply. Columns (`data-col`) and caption lines (`data-caption`) of the competitors
 * not shown are hidden; the caption names the visible pair.
 */
const PICK_RULES: Record<CompetitorId, string> = {
  onetab: '[&[data-chosen=onetab]_[data-col]:not([data-col=onetab])]:hidden [&[data-chosen=onetab]_[data-caption=onetab]]:inline',
  sessionBuddy:
    '[&[data-chosen=sessionBuddy]_[data-col]:not([data-col=sessionBuddy])]:hidden [&[data-chosen=sessionBuddy]_[data-caption=sessionBuddy]]:inline',
  toby: '[&[data-chosen=toby]_[data-col]:not([data-col=toby])]:hidden [&[data-chosen=toby]_[data-caption=toby]]:inline',
  workona: '[&[data-chosen=workona]_[data-col]:not([data-col=workona])]:hidden [&[data-chosen=workona]_[data-caption=workona]]:inline',
  tabManagerPlus:
    '[&[data-chosen=tabManagerPlus]_[data-col]:not([data-col=tabManagerPlus])]:hidden [&[data-chosen=tabManagerPlus]_[data-caption=tabManagerPlus]]:inline',
  tabSessionManager:
    '[&[data-chosen=tabSessionManager]_[data-col]:not([data-col=tabSessionManager])]:hidden [&[data-chosen=tabSessionManager]_[data-caption=tabSessionManager]]:inline',
  tabsOutliner:
    '[&[data-chosen=tabsOutliner]_[data-col]:not([data-col=tabsOutliner])]:hidden [&[data-chosen=tabsOutliner]_[data-caption=tabsOutliner]]:inline',
  simpleTabGroups:
    '[&[data-chosen=simpleTabGroups]_[data-col]:not([data-col=simpleTabGroups])]:hidden [&[data-chosen=simpleTabGroups]_[data-caption=simpleTabGroups]]:inline',
  tabWrangler:
    '[&[data-chosen=tabWrangler]_[data-col]:not([data-col=tabWrangler])]:hidden [&[data-chosen=tabWrangler]_[data-caption=tabWrangler]]:inline',
}

const SHOW_RULES = [
  // No pick: below md, TabMerger vs the default competitor.
  'max-md:[&[data-chosen=auto]_[data-col]:not([data-col=onetab])]:hidden',
  'max-md:[&[data-chosen=auto]_[data-caption=onetab]]:inline',
  '[&:not([data-chosen=auto])_[data-caption=all]]:hidden',
  // A pick: that competitor only, at every width.
  ...Object.values(PICK_RULES),
].join(' ')

/** "All tools" is only offered where every column has room to scroll (`md`, 48rem, and up). */
const WIDE_QUERY = '(min-width: 48rem)'

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const isWide = () => window.matchMedia(WIDE_QUERY).matches
/** Unknown on the server and while hydrating. */
const wideOnServer = () => null

interface CompetitorPickerProps {
  /** The competitors in column order, by their own (untranslated) names. */
  competitors: readonly { id: CompetitorId; name: string }[]
  /** The dropdown's visible label ("Compare TabMerger with"). */
  label: string
  /** The "All tools" option. */
  allTools: string
  /** The comparison table (and its legend), server-rendered with every column. */
  children: ReactNode
}

/**
 * The "Compare TabMerger with" dropdown above the table (shadcn `Select`): one competitor, or
 * "All tools" (offered from `md` up). Picking only flips `data-chosen` and
 * `data-compare-layout` on the wrapper; the table's HTML, every column included, comes from the
 * server. Until something is picked the breakpoint decides (all five columns on wide screens,
 * TabMerger vs OneTab on phones), so the page reads right without JavaScript. A pick stays when
 * the window is resized; with two columns showing the rows stack (label above the two cells).
 */
export function CompetitorPicker({ competitors, label, allTools, children }: CompetitorPickerProps) {
  const [shown, setShown] = useState<Shown>('auto')
  const wide = useSyncExternalStore(subscribeWide, isWide, wideOnServer)
  const triggerId = useId()

  // The option the dropdown marks: the pick, or what the breakpoint shows (none while unknown).
  const value = shown !== 'auto' ? shown : wide === null ? '' : wide ? 'all' : DEFAULT_COMPETITOR
  const defaultName = competitors.find((c) => c.id === DEFAULT_COMPETITOR)?.name
  const pickedName = competitors.find((c) => c.id === shown)?.name
  // No pick: the label follows the breakpoint, like the table. It is also the placeholder,
  // because the server (and a page without JavaScript) has no value yet and Radix then shows the
  // placeholder instead of the children.
  const breakpointLabel = (
    <>
      <span className="max-md:hidden">{allTools}</span>
      <span className="md:hidden">{defaultName}</span>
    </>
  )

  return (
    <>
      <div className="mt-6 flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
        <label htmlFor={triggerId} className="text-sm font-medium text-text2">
          {label}
        </label>
        <Select value={value} onValueChange={(next) => setShown(next === 'all' ? 'auto' : (next as CompetitorId))}>
          <SelectTrigger id={triggerId} className="w-full bg-card md:w-64">
            <SelectValue placeholder={breakpointLabel}>{pickedName ?? breakpointLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {wide && <SelectItem value="all">{allTools}</SelectItem>}
            {competitors.map(({ id, name }) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        data-chosen={shown}
        data-compare-layout={shown === 'auto' ? 'auto' : 'stacked'}
        className={SHOW_RULES}
      >
        {children}
      </div>
    </>
  )
}
