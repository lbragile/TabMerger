import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { blogPostPath, type AdjacentPost } from '@/lib/blog/posts'
import { cn } from '@/lib/utils'

/**
 * "More posts" at the end of a post: a link to the older post ("← Previous") at the start and to
 * the newer one ("Next →") at the end, each only when that post exists; nothing at all (no empty
 * landmark) when neither does. Each is two rows: a small label, then the post's title (or its
 * `navTitle`) on one line, cut with an ellipsis; the full title is in the accessible name
 * ("Previous post: <title>") and the tooltip.
 * Styled like the post cards; arrows mirror in right-to-left pages.
 */
export function PostNav({ older, newer }: { older?: AdjacentPost; newer?: AdjacentPost }) {
  const t = useTranslations('blog')
  if (!older && !newer) return null
  const card = (post: AdjacentPost, end: boolean) => {
    const name = end ? t('nextPostNamed', { title: post.title }) : t('previousPostNamed', { title: post.title })
    return (
      <Link
        href={blogPostPath(post.slug)}
        aria-label={name}
        title={name}
        className={cn(
          'group flex min-h-11 min-w-0 flex-col gap-0.5 border border-border bg-surface p-3 no-underline transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          end ? 'col-start-2 items-end text-end' : 'col-start-1 items-start text-start'
        )}
      >
        <span aria-hidden="true" className={cn('inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text3', end && 'flex-row-reverse')}>
          {end ? <ArrowRight className="size-3.5 rtl:-scale-x-100" /> : <ArrowLeft className="size-3.5 rtl:-scale-x-100" />}
          {end ? t('nextPost') : t('previousPost')}
        </span>
        {/* dir="auto": a title in another script (English on a Hebrew page) is cut at its own end. */}
        <span aria-hidden="true" dir="auto" className="block w-full truncate font-semibold leading-snug text-foreground group-hover:text-primary">
          {post.title}
        </span>
      </Link>
    )
  }
  return (
    <nav aria-label={t('morePosts')} className="mb-12 mt-10 grid grid-cols-2 gap-3 sm:gap-4">
      {older && card(older, false)}
      {newer && card(newer, true)}
    </nav>
  )
}
