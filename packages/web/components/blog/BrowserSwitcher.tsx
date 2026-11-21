'use client'

import { useRef, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useBlogPostState } from '@/components/blog/BlogPostState'
import { CopyLinkButton } from '@/components/blog/CopyLinkButton'
import { BROWSER_NAME, SWITCHER_BROWSERS, browserPanelId, browserTabId } from '@/lib/blog/browsers'
import type { InstallBrowser } from '@/lib/installBrowser'
import { cn } from '@/lib/utils'

/** Moves the selection `step` tabs along, wrapping at the ends. */
function stepBrowser(current: InstallBrowser, step: number): InstallBrowser {
  const i = SWITCHER_BROWSERS.indexOf(current)
  const n = SWITCHER_BROWSERS.length
  return SWITCHER_BROWSERS[(i + step + n) % n]
}

/**
 * The post's browser switcher (Chrome / Edge / Firefox): a WAI-ARIA tablist whose tabs control
 * every browser panel in the article (`aria-controls` lists each section's panel). Arrow keys
 * move and select (automatic activation, mirrored in right-to-left pages), Home and End jump to
 * the ends; only the selected tab is in the Tab order.
 */
export function BrowserSwitcher() {
  const t = useTranslations('blog.interactive')
  const { browser, setBrowser, browserSections } = useBlogPostState()
  const tabs = useRef<Partial<Record<InstallBrowser, HTMLButtonElement | null>>>({})

  const select = (next: InstallBrowser) => {
    setBrowser(next)
    tabs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    let next: InstallBrowser | undefined
    if (event.key === forward) next = stepBrowser(browser, 1)
    else if (event.key === back) next = stepBrowser(browser, -1)
    else if (event.key === 'Home') next = SWITCHER_BROWSERS[0]
    else if (event.key === 'End') next = SWITCHER_BROWSERS[SWITCHER_BROWSERS.length - 1]
    if (!next) return
    event.preventDefault()
    select(next)
  }

  return (
    <div className="mb-10 flex flex-wrap items-center gap-2 border border-border bg-surface2 p-3">
      <span id="blog-switcher-label" className="me-1 text-sm text-text2">
        {t('switcherLabel')}
      </span>
      <div role="tablist" aria-labelledby="blog-switcher-label" className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
        {SWITCHER_BROWSERS.map((b) => {
          const selected = b === browser
          return (
            <button
              key={b}
              ref={(el) => {
                tabs.current[b] = el
              }}
              type="button"
              role="tab"
              id={browserTabId(b)}
              aria-selected={selected}
              aria-controls={browserSections.map((s) => browserPanelId(s, b)).join(' ') || undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => setBrowser(b)}
              className={cn(
                'min-h-11 border px-4.5 text-[0.9375rem] font-semibold transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border2 bg-transparent text-foreground hover:bg-surface3'
              )}
            >
              {BROWSER_NAME[b]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The rail's copy of the switcher: toggle buttons (`aria-pressed`) that drive the same choice,
 * plus the post's per-browser fact (e.g. the startup settings URL). A second tablist for the same
 * panels would repeat the tab ids, so this one is a button group.
 */
export function RailBrowserSwitcher({ fact }: { fact?: { label: string; values: Record<InstallBrowser, string> } }) {
  const t = useTranslations('blog.interactive')
  const { browser, setBrowser } = useBlogPostState()
  return (
    <>
      {/* One segmented row: 2.25rem high with a mouse, 2.75rem (the touch target) on touch screens. */}
      <div role="group" aria-label={t('railSwitcherLabel')} className="flex border border-border2">
        {SWITCHER_BROWSERS.map((b) => {
          const pressed = b === browser
          return (
            <button
              key={b}
              type="button"
              aria-pressed={pressed}
              onClick={() => setBrowser(b)}
              className={cn(
                'min-h-9 flex-1 px-2 text-[0.8125rem] font-semibold transition-colors pointer-coarse:min-h-11',
                'focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                pressed ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground hover:bg-surface3'
              )}
            >
              {BROWSER_NAME[b]}
            </button>
          )
        })}
      </div>
      {fact && (
        <p className="group/link mt-2 flex min-w-0 items-center gap-1 text-[0.8125rem] text-text2">
          <span className="shrink-0">{fact.label}:</span>
          <code title={fact.values[browser]} className="min-w-0 truncate bg-surface3 px-1 font-mono text-[0.9em] text-foreground">
            {fact.values[browser]}
          </code>
          <CopyLinkButton url={fact.values[browser]} kind="address" />
        </p>
      )}
    </>
  )
}
