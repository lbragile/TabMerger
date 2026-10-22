import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ERROR_CODES, type ErrorKind, type ErrorPageLink } from './copy'
import { ShellGlows } from './ShellGlows'

/**
 * The look shared by every error page: a browser-window illustration with the status code, the
 * heading and copy, the caller's actions, and a row of helpful links, over soft glows that follow
 * the pointer.
 *
 * No async work and no context but the translations, so the server-rendered 404, the client
 * `error.tsx` boundaries and `global-error.tsx` (which brings its own provider) can all render it.
 */
export interface ErrorPageShellProps {
  /**
   * `notFound` (404): a tab has drifted out of the strip. `serverError` (500): the drifting tab
   * shows a warning. Picks the `errors.<kind>` messages.
   */
  kind: ErrorKind
  /** Buttons under the copy (Back to home, Try again). */
  actions: ReactNode
  links: ErrorPageLink[]
  /** Extra content under the actions, e.g. the copyable reference ID. */
  children?: ReactNode
  /** `main` where no layout above already provides the page's `<main>` landmark. */
  as?: 'main' | 'div'
  /**
   * `global-error.tsx` renders after the root layout itself failed, so it uses plain anchors:
   * a full page load is the safest way out of that state.
   */
  plainLinks?: boolean
  className?: string
}

/**
 * Two soft glows behind the page, the main one under the pointer, and a grid that shows only in
 * a circle around the pointer (`ShellGlows`). The parent must be `relative isolate` (and
 * `overflow-hidden`): the layer sits at `-z-10` in the parent's stacking context, so only the
 * parent's own background paints below it.
 */
export function ShellBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <ShellGlows />
    </div>
  )
}

export function ErrorPageShell({
  kind,
  actions,
  links,
  children,
  as: Component = 'div',
  plainLinks = false,
  className,
}: ErrorPageShellProps) {
  const t = useTranslations('errors')
  return (
    <Component
      className={cn(
        'relative isolate flex flex-1 items-center justify-center overflow-hidden px-4 py-16 sm:px-6 sm:py-24',
        className
      )}
    >
      <ShellBackdrop />

      <div className="relative mx-auto flex w-full min-w-0 max-w-[36rem] flex-col items-center text-center">
        <BrowserIllustration kind={kind} />

        <p className="mt-10 text-xs font-semibold uppercase tracking-widest text-primary">{t(`${kind}.eyebrow`)}</p>
        <h1
          className="mt-3 text-[2rem] font-bold leading-tight tracking-tight text-foreground sm:text-[2.75rem]"
          style={{ letterSpacing: '-0.02em' }}
        >
          {t(`${kind}.title`)}
        </h1>
        <p className="mt-4 max-w-[40ch] text-base text-text2">{t(`${kind}.description`)}</p>

        <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          {actions}
        </div>

        {children}

        <nav aria-label={t('helpfulLinks')} className="mt-10 w-full border-t border-border pt-6">
          <p className="mb-3 text-xs text-text3">{t('tryThese')}</p>
          <ul className="flex flex-wrap justify-center gap-x-1 gap-y-2">
            {links.map((link) => (
              <li key={link.href}>
                <ShellLink
                  href={link.href}
                  plain={plainLinks}
                  className="inline-flex h-8 items-center px-3 text-sm text-text2 transition-colors hover:bg-surface2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t(`links.${link.label}`)}
                </ShellLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Component>
  )
}

/** A Next.js `<Link>`, or a plain `<a>` when `plain` is set (see `plainLinks`). */
export function ShellLink({
  href,
  plain,
  className,
  children,
}: {
  href: string
  plain?: boolean
  className?: string
  children: ReactNode
}) {
  return plain ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

/**
 * A small browser window: a tab strip with an empty slot where one tab used to be, and that tab
 * floating away above it. Purely decorative (the eyebrow states the status in words).
 */
function BrowserIllustration({ kind }: { kind: ErrorKind }) {
  const t = useTranslations('errors')
  const lost = kind === 'notFound'
  return (
    <div aria-hidden="true" className="relative w-full max-w-[22rem] select-none" data-testid="error-illustration">
      {/* The tab that left the strip. `rotate-*` is the CSS `rotate` property in Tailwind v4, so
          it composes with the float animation's `transform` instead of being overwritten. It
          hangs off the strip's end corner, so right to left it moves to the left and tilts the
          other way. */}
      <div className="absolute -top-6 inset-e-1 z-10 rotate-[7deg] rtl:-rotate-[7deg] motion-safe:animate-tab-float sm:-inset-e-8">
        <div
          className={cn(
            'flex h-8 items-center gap-1.5 border border-dashed bg-card px-2.5 text-[0.75rem] font-medium text-text2 shadow-sh2',
            lost ? 'border-primary/70' : 'border-destructive/70'
          )}
        >
          {lost ? (
            <span className="grid h-4 w-4 place-items-center bg-primary/15 text-[0.625rem] font-bold text-primary">
              ?
            </span>
          ) : (
            <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
          )}
          <span>{t(`${kind}.tabLabel`)}</span>
        </div>
      </div>

      <div className="overflow-hidden border border-border bg-card text-start shadow-sh3">
        <div className="flex items-end gap-1 border-b border-border bg-surface2 px-2 pt-2">
          <span className="mb-2.5 me-1.5 flex gap-1">
            <span className="h-2 w-2 rounded-full bg-border2" />
            <span className="h-2 w-2 rounded-full bg-border2" />
            <span className="h-2 w-2 rounded-full bg-border2" />
          </span>
          <MiniTab label={t('illustrationTabResearch')} dotClassName="bg-primary" active />
          <MiniTab label={t('illustrationTabDocs')} dotClassName="bg-ok" />
          {/* Where the drifting tab used to sit. */}
          <span className="h-7 w-14 shrink-0 border border-b-0 border-dashed border-border2 sm:w-16" />
        </div>
        <div className="px-3 pt-3">
          <div className="flex h-7 items-center gap-2 bg-surface2 px-2.5 font-mono text-[0.6875rem] text-text3">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text3/60" />
            {/* An address reads left to right in every language. */}
            <span dir="ltr" className="truncate">tabmerger.com/…</span>
          </div>
        </div>
        <div className="grid place-items-center px-4 pb-8 pt-6">
          <span
            className="bg-clip-text text-[5rem] font-bold leading-none tracking-tighter text-transparent sm:text-[6.5rem]"
            style={{ backgroundImage: 'var(--gradient-brand)' }}
          >
            {ERROR_CODES[kind]}
          </span>
        </div>
      </div>
    </div>
  )
}

function MiniTab({ label, dotClassName, active }: { label: string; dotClassName: string; active?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-7 min-w-0 items-center gap-1.5 border border-b-0 px-2.5 text-[0.6875rem] font-medium',
        active ? 'border-border bg-card text-foreground' : 'border-transparent text-text3'
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClassName)} />
      <span className="truncate">{label}</span>
    </span>
  )
}
