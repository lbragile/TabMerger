'use client'

import { useTranslations } from 'next-intl'
import { useDetectedBrowser } from '@/components/blog/BlogPostState'
import { ChromeIcon, EdgeIcon, FirefoxIcon } from '@/components/marketing/BrowserIcons'
import { StoreLink } from '@/components/StoreLink'
import { BROWSER_NAME } from '@/lib/blog/browsers'
import { orderInstallBrowsers, type InstallBrowser } from '@/lib/installBrowser'
import type { StoreLinks } from '@/lib/storeLinks'
import { cn } from '@/lib/utils'

/** Each browser's icon and its `blog.interactive` label key. */
const BUTTONS = {
  chrome: { Icon: ChromeIcon, label: 'installChrome' },
  firefox: { Icon: FirefoxIcon, label: 'installFirefox' },
  edge: { Icon: EdgeIcon, label: 'installEdge' },
} as const satisfies Record<InstallBrowser, { Icon: unknown; label: string }>

/**
 * Install buttons for the blog, the reader's browser first and filled, the other two outlined.
 *
 * The blog doesn't read the request's User-Agent (that would render it per request), so the
 * server HTML leads with Chrome and the order is fixed after hydration from
 * `navigator.userAgent`. The buttons are the same height, so the reorder doesn't shift the
 * layout. `links` come from `getStoreLinks()` on the server (they depend on the deployment).
 */
export function BlogInstallCta({
  links,
  layout = 'row',
}: {
  links: StoreLinks
  /**
   * `row`: three buttons in a wrapping row. `compact` (the rail): the reader's browser full width,
   * the other two side by side with just the browser's name (their full label is the name).
   */
  layout?: 'row' | 'compact'
}) {
  const t = useTranslations('blog.interactive')
  const browser = useDetectedBrowser()
  if (layout === 'compact') {
    const [first, ...rest] = orderInstallBrowsers(browser)
    const button = (b: InstallBrowser, primary: boolean) => {
      const { Icon, label } = BUTTONS[b]
      return (
        <StoreLink
          key={b}
          href={links[b]}
          data-primary={primary ? '' : undefined}
          aria-label={primary ? undefined : t(label)}
          className={cn(
            'inline-flex min-h-9 items-center justify-center gap-2 border px-3 text-sm font-semibold no-underline transition-colors pointer-coarse:min-h-11',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            primary
              ? 'w-full border-foreground bg-foreground text-background hover:bg-foreground/90'
              : 'min-w-0 flex-1 border-border2 bg-transparent text-foreground hover:bg-surface3'
          )}
        >
          <span aria-hidden="true" className="inline-flex">
            <Icon size={18} />
          </span>
          {primary ? t(label) : BROWSER_NAME[b]}
        </StoreLink>
      )
    }
    return (
      <div role="group" aria-label={t('installLabel')} className="flex flex-col gap-1.5">
        {button(first, true)}
        <div className="flex gap-1.5">{rest.map((b) => button(b, false))}</div>
      </div>
    )
  }
  return (
    <div role="group" aria-label={t('installLabel')} className="flex flex-wrap gap-2">
      {orderInstallBrowsers(browser).map((b, i) => {
        const { Icon, label } = BUTTONS[b]
        return (
          <StoreLink
            key={b}
            href={links[b]}
            data-primary={i === 0 ? '' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 border px-4 text-[0.9375rem] font-semibold no-underline transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              i === 0
                ? 'border-foreground bg-foreground text-background hover:bg-foreground/90'
                : 'border-border2 bg-transparent text-foreground hover:bg-surface3'
            )}
          >
            {/* The label already names the browser: the icon's own name would repeat it. */}
            <span aria-hidden="true" className="inline-flex">
              <Icon size={20} />
            </span>
            {t(label)}
          </StoreLink>
        )
      })}
    </div>
  )
}
