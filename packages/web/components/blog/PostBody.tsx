import type { ComponentProps, ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { CopyLinkButton } from '@/components/blog/CopyLinkButton'
import { Link } from '@/i18n/navigation'
import { cn, getMetadataBase } from '@/lib/utils'
import { isScheduledPostLink, type Post } from '@/lib/blog/posts'
import { isProductionDeployment } from '@/lib/deployment'

/**
 * The building blocks a post's MDX may use (registered in mdx-components.tsx), plus the styled
 * markdown elements. Server components: only the browser and screenshot switches are interactive.
 * Colours are the site's theme tokens, so a post follows the light and dark themes.
 */

/**
 * The "#" link after a heading (`heading-anchor`: rehype-autolink-headings on Markdown headings,
 * `HeadingAnchor` on sections): hidden until the heading is hovered. It is aria-hidden and out of
 * the Tab order, so it only offers a copyable link to pointer users; the contents list covers
 * keyboard and screen-reader navigation.
 */
const HEADING_ANCHOR =
  '[&_.heading-anchor]:ms-2 [&_.heading-anchor]:font-normal [&_.heading-anchor]:text-text3 [&_.heading-anchor]:no-underline [&_.heading-anchor]:opacity-0 [&_.heading-anchor]:transition-opacity hover:[&_.heading-anchor]:opacity-100'

function HeadingAnchor({ id }: { id: string }) {
  return (
    <a href={`#${id}`} aria-hidden="true" tabIndex={-1} className="heading-anchor">
      #
    </a>
  )
}

/** Matches the anchors in a post's `toc` and `browserSections`. */
const SECTION_ID = /^[a-z0-9-]+$/

/**
 * One numbered part of a post: `<section id>` labelled by its `<h2>`. The id is written in the
 * post (not derived from the heading), so anchors stay the same when the text is translated.
 */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  if (!SECTION_ID.test(id)) throw new Error(`Blog section id "${id}" must match ${SECTION_ID}`)
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="blog-section mb-12 mt-16 scroll-mt-24 first:mt-0">
      <h2 id={`${id}-h`} className={cn('mb-3 text-[1.625rem] font-bold leading-tight tracking-tight', HEADING_ANCHOR)}>
        {title}
        <HeadingAnchor id={id} />
      </h2>
      {children}
    </section>
  )
}

/** The self-contained answer at the top (the text answer engines quote). */
export function QuickAnswer({ id = 'quick', children }: { id?: string; children: ReactNode }) {
  const t = useTranslations('blog')
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="my-8 scroll-mt-24 border border-primary/30 bg-primary/5 px-6 py-5 dark:bg-accent [&>p]:m-0 [&>p]:text-[1.0625rem]"
    >
      <h2 id={`${id}-h`} className="mb-2 text-base font-bold text-primary">
        {t('quickAnswer')}
      </h2>
      {children}
    </section>
  )
}

/** "The catch:" what a method misses. */
export function Catch({ children }: { children: ReactNode }) {
  const t = useTranslations('blog')
  return (
    <div className="border border-secondary/40 bg-accent px-4 py-3.5 text-base leading-relaxed dark:border-secondary/30 dark:bg-secondary/10 [&>p]:m-0 [&>p]:inline [&>p]:text-base">
      <strong className="me-1 text-accent-foreground dark:text-secondary">{t('catch')}</strong> {children}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="whitespace-nowrap border border-b-2 border-border2 bg-surface2 px-1.5 py-px font-mono text-[0.82em] text-foreground">
      {children}
    </kbd>
  )
}

/**
 * A table from data (posts use no markdown tables: that needs remark-gfm). `head` is the column
 * headings, `rows` the cells (strings or inline JSX such as `<Kbd>`). With `rowHeaders` the first
 * cell of each row is its header. `highlight` is a column index to tint (TabMerger's column).
 */
export function ComparisonTable({
  head,
  rows,
  rowHeaders = false,
  highlight,
  keysColumn,
  minWidth = '26rem',
  className,
}: {
  head: readonly ReactNode[]
  rows: readonly (readonly ReactNode[])[]
  rowHeaders?: boolean
  highlight?: number
  /** A column of shortcuts written as "Ctrl+Shift+P": each key is rendered as a `<Kbd>`. */
  keysColumn?: number
  minWidth?: string
  className?: string
}) {
  const width = /^\d+(\.\d+)?rem$/.test(minWidth) ? minWidth : '26rem'
  return (
    // Focusable so keyboard users can scroll a table wider than a phone screen.
    <div tabIndex={0} className={cn('mb-3 overflow-x-auto border border-border focus-visible:outline-2 focus-visible:outline-ring', className)}>
      <table className="w-full border-collapse text-[0.9375rem]" style={{ minWidth: width }}>
        <thead>
          <tr className="bg-surface2 text-start">
            {head.map((cell, i) => (
              <th key={i} scope="col" className={cn('px-4 py-3 text-start font-semibold', i === highlight && 'text-primary')}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-text2">
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-border">
              {row.map((cell, i) =>
                rowHeaders && i === 0 ? (
                  <th key={i} scope="row" className="px-4 py-3 text-start font-semibold text-foreground">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className="px-4 py-3">
                    {i === keysColumn && typeof cell === 'string' ? <Keys combo={cell} /> : cell}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Ctrl+Shift+P" as Ctrl + Shift + P keys. */
function Keys({ combo }: { combo: string }) {
  const keys = combo.split('+')
  return (
    <>
      {keys.map((key, i) => (
        <span key={i}>
          {i > 0 && '+'}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </>
  )
}

/** Splits `answer` at the first `link.text` and links it; the plain answer feeds FAQPage JSON-LD. */
function FaqAnswer({ item }: { item: Post['faq'][number] }) {
  const at = item.link ? item.answer.indexOf(item.link.text) : -1
  if (!item.link || at < 0) return <>{item.answer}</>
  return (
    <>
      {item.answer.slice(0, at)}
      <PostLink href={item.link.href}>{item.link.text}</PostLink>
      {item.answer.slice(at + item.link.text.length)}
    </>
  )
}

/** The post's FAQ, from `post.faq`, the same items its FAQPage structured data lists. */
export function Faq({ items }: { items: Post['faq'] }) {
  return (
    <div className="border-t border-border">
      {items.map((item) => (
        <div key={item.question} className="border-b border-border py-4">
          <h3 className="mb-1.5 text-[1.0625rem] font-semibold">{item.question}</h3>
          <p className="m-0 leading-relaxed text-text2">
            <FaqAnswer item={item} />
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * A link in a post: a site path goes through the locale-aware Link, anything else is a plain
 * anchor (rehype-external-links has already given body links their new-tab attributes). Every
 * link but an in-page `#anchor` is followed by a copy button for its absolute URL. On production,
 * a link to a post that isn't live yet is plain text (`isScheduledPostLink`).
 */
export function PostLink({ href = '', children, className, ...rest }: ComponentProps<'a'>) {
  // In-page anchors (the heading "#" links) keep only their own classes and get no copy button.
  if (href.startsWith('#')) {
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    )
  }
  const internal = href.startsWith('/') && !href.startsWith('//')
  // A link to a post scheduled for a later date: its page is a 404 on production until then, so
  // the words stay but the link doesn't (preview and local development link it, the page exists).
  if (internal && isProductionDeployment() && isScheduledPostLink(href)) return <>{children}</>
  const classes = cn('text-primary underline underline-offset-[0.18em] hover:text-primary/80', className)
  const absolute = new URL(href, getMetadataBase()).href
  return (
    <span className="group/link">
      {internal ? (
        <Link href={href} className={classes}>
          {children}
        </Link>
      ) : (
        <a href={href} className={classes} {...rest}>
          {children}
        </a>
      )}
      <CopyLinkButton url={absolute} />
    </span>
  )
}

/** A browser's own settings address (chrome://, edge://, about:): browsers block links to these from web pages. */
export const BROWSER_URL = /^(chrome|edge|about):/

/**
 * A browser-internal address as code with a copy button, never a link (a web page can't open
 * chrome://, edge:// or about: pages). Screen readers also hear "paste it into the address bar".
 * Plain inline code matching `BROWSER_URL` in a post renders as this.
 */
export function BrowserUrl({ children }: { children: string }) {
  const t = useTranslations('blog.interactive')
  const url = String(children).trim()
  return (
    <span className="group/link whitespace-nowrap">
      <code className="bg-surface3 px-1 py-px font-mono text-[0.9em] text-foreground">{url}</code>
      <span className="sr-only">
        {' '}
        {t('pasteHint')}
      </span>
      <CopyLinkButton url={url} kind="address" />
    </span>
  )
}

/** Styles for the markdown a post writes (paragraphs, lists, emphasis, inline code, h3). */
export const POST_ELEMENTS = {
  p: (props: ComponentProps<'p'>) => <p className="mb-4 text-[1.0625rem] leading-[1.7] text-text2" {...props} />,
  ol: (props: ComponentProps<'ol'>) => (
    <ol className="mb-5 flex list-decimal flex-col gap-2 ps-6 text-[1.0625rem] leading-relaxed text-text2 [&_p]:m-0" {...props} />
  ),
  ul: (props: ComponentProps<'ul'>) => (
    <ul className="mb-4 flex list-disc flex-col gap-2 ps-6 text-[1.0625rem] leading-relaxed text-text2 [&_p]:m-0" {...props} />
  ),
  strong: (props: ComponentProps<'strong'>) => <strong className="font-semibold text-foreground" {...props} />,
  code: ({ children, ...props }: ComponentProps<'code'>) =>
    typeof children === 'string' && BROWSER_URL.test(children) ? (
      <BrowserUrl>{children}</BrowserUrl>
    ) : (
      <code className="bg-surface3 px-1 py-px font-mono text-[0.9em] text-foreground" {...props}>
        {children}
      </code>
    ),
  h2: (props: ComponentProps<'h2'>) => (
    <h2 className={cn('mb-3 scroll-mt-24 text-[1.625rem] font-bold leading-tight tracking-tight', HEADING_ANCHOR)} {...props} />
  ),
  h3: (props: ComponentProps<'h3'>) => (
    <h3 className={cn('mb-3 mt-2 scroll-mt-24 text-[1.1875rem] font-semibold', HEADING_ANCHOR)} {...props} />
  ),
  h4: (props: ComponentProps<'h4'>) => <h4 className={cn('mb-2 mt-2 scroll-mt-24 font-semibold', HEADING_ANCHOR)} {...props} />,
  table: ({ className, ...props }: ComponentProps<'table'>) => (
    <div className="mb-4 overflow-x-auto border border-border">
      <table className={cn('w-full border-collapse text-[0.9375rem]', className)} {...props} />
    </div>
  ),
  th: (props: ComponentProps<'th'>) => <th className="bg-surface2 px-4 py-3 text-start font-semibold" {...props} />,
  td: (props: ComponentProps<'td'>) => <td className="border-t border-border px-4 py-3 text-text2" {...props} />,
  a: PostLink,
}
