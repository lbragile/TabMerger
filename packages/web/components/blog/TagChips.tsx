import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BLOG_TAGS, blogTagPath, type BlogTag } from '@/lib/blog/tags'
import { cn } from '@/lib/utils'

const CHIP =
  'inline-flex min-h-11 max-w-full items-center border border-border bg-surface2 px-3 font-mono text-[0.8125rem] text-text2 no-underline [overflow-wrap:anywhere] transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * A post's topic tags as "#label" links to each tag's page (under the byline and on post cards;
 * never inside the article text). The row wraps and a long label breaks rather than overflow.
 * With `max` (cards), only the first `max` show, then a "+N" chip linking to the post (`moreHref`).
 * Inside a card the chips sit above the card's stretched link (`relative z-10`).
 */
export function TagChips({
  tags,
  max,
  moreHref,
  size = 'md',
  className,
}: {
  tags: readonly BlogTag[]
  max?: number
  moreHref?: string
  /** `sm`: the small chips of the blog index (a 24px target, still above WCAG's minimum). */
  size?: 'md' | 'sm'
  className?: string
}) {
  const t = useTranslations('blog')
  if (tags.length === 0) return null
  const chip = size === 'sm' ? CHIP.replace('min-h-11', 'min-h-6').replace('px-3', 'px-2').replace('text-[0.8125rem]', 'text-xs') : CHIP
  const shown = max !== undefined ? tags.slice(0, max) : tags
  const hidden = tags.length - shown.length
  return (
    <ul aria-label={t('tagsLabel')} className={cn('m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0', className)}>
      {shown.map((tag) => (
        <li key={tag} className="relative z-10 min-w-0 max-w-full">
          {/* dir="auto": the "#" sits before the label in its own script's direction. */}
          <Link href={blogTagPath(tag)} dir="auto" className={chip}>
            {'#'}
            {t(`tags.${BLOG_TAGS[tag]}`)}
          </Link>
        </li>
      ))}
      {hidden > 0 && moreHref && (
        <li className="relative z-10">
          <Link href={moreHref} aria-label={t('moreTags', { count: hidden })} className={chip}>
            {'+'}
            {hidden}
          </Link>
        </li>
      )}
    </ul>
  )
}
