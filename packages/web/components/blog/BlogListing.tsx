import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { CoverImage } from '@/components/blog/CoverImage'
import { HelpfulCount } from '@/components/blog/HelpfulCounts'
import { PagerView, type PagerLabels } from '@/components/blog/PagerView'
import { SearchHighlight } from '@/components/blog/SearchHighlight'
import { TagChips } from '@/components/blog/TagChips'
import { TestedOn } from '@/components/blog/TestedOn'
import { Link } from '@/i18n/navigation'
import { BLOG_PATH, blogPostPath, cardCover, isPublished, isRevised, shownDate, type LoadedPost, type Post } from '@/lib/blog/posts'
import { BLOG_TAGS, BLOG_TAGS_INDEX_PATH, blogTagPath, type BlogTag } from '@/lib/blog/tags'
import { visibleChips } from '@/lib/blog/tagOrder'
import { cn } from '@/lib/utils'

/**
 * The blog index and tag pages (design A): topic chips, the newest post as a featured panel on
 * page 1, then the "More guides" rows, then the pager. Every card is one link (its title, stretched
 * over the card with `::after`); tag chips sit above it and stay links of their own. No rules
 * between rows: spacing only.
 */

/**
 * Keyboard focus on the title link outlines the whole card. Hover (and focus inside) shows a 1px
 * border, transparent at rest so nothing moves; no dividers between cards.
 */
const CARD_FOCUS =
  'group border border-transparent transition-colors hover:border-primary/50 focus-within:border-primary/50 has-[.post-link:focus-visible]:outline-2 has-[.post-link:focus-visible]:outline-offset-2 has-[.post-link:focus-visible]:outline-ring'
const STRETCHED = 'post-link after:absolute after:inset-0 hover:text-primary focus-visible:outline-none'

/** "Nov 19, 2026 · 4 min read · 👍 12" (or "Updated <date>" once revised; the count loads later). */
function PostMeta({ loaded, className }: { loaded: LoadedPost; className?: string }) {
  const t = useTranslations('blog')
  const format = useFormatter()
  const { post, readMinutes } = loaded
  const dateIso = shownDate(post)
  const date = format.dateTime(new Date(`${dateIso}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })
  return (
    <p className={cn('m-0 text-text3', className)}>
      {isRevised(post) ? (
        t.rich('cardRevised', { date, time: (chunks) => <time dateTime={dateIso}>{chunks}</time> })
      ) : (
        <time dateTime={dateIso}>{date}</time>
      )}
      {' · '}
      {t('readTime', { minutes: readMinutes })}
      <HelpfulCount slug={post.slug} />
    </p>
  )
}

/**
 * "Scheduled for <date>" on the card of a post that isn't live yet. Such cards are listed only
 * under `next dev` (`scheduledPreviewEnabled`), so this never shows on preview or production.
 */
function ScheduledFlag({ post }: { post: Pick<Post, 'published'> }) {
  const t = useTranslations('blog')
  const format = useFormatter()
  if (isPublished(post)) return null
  const date = format.dateTime(new Date(`${post.published}T00:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' })
  return (
    <p className="m-0 self-start border border-secondary/40 bg-accent px-2 py-0.5 text-[0.8125rem] font-semibold text-accent-foreground dark:border-secondary/30 dark:bg-secondary/10 dark:text-secondary">
      {t('scheduledCard', { date })}
    </p>
  )
}

/**
 * The card image, 4:3, shown whole: the post's cover (or its first 4:3 capture), following the theme
 * when it has a dark version; decorative (the title names the card).
 */
function Cover({ loaded, eager, sizes, className }: { loaded: LoadedPost; eager?: boolean; sizes: string; className?: string }) {
  return (
    <div className={cn('relative aspect-[4/3] overflow-hidden border border-border bg-surface2', className)}>
      <CoverImage cover={cardCover(loaded)} eager={eager} sizes={sizes} />
    </div>
  )
}

/**
 * "All posts" and the most relevant tags (most posts first: `tags` comes ordered), at most
 * `TOPIC_CHIP_LIMIT` of them plus the current tag when it falls outside those, then "See all
 * topics" (the all-topics page) when some are left out. The current one (index or tag) is marked.
 */
export function TopicChips({ tags, current }: { tags: readonly BlogTag[]; current?: BlogTag }) {
  const t = useTranslations('blog')
  const { shown, hidden } = visibleChips(tags, current)
  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border px-3.5 font-mono text-[0.8125rem] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm',
      active ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-text2 hover:border-primary/50 hover:text-foreground'
    )
  return (
    <nav aria-label={t('tagsLabel')} className="-mx-6 mt-6 overflow-x-auto px-6 sm:mx-0 sm:mt-8 sm:overflow-visible sm:px-0">
      <ul className="m-0 flex list-none gap-2 p-0 sm:flex-wrap [&>li]:shrink-0">
        <li>
          <Link href={BLOG_PATH} aria-current={current ? undefined : 'page'} className={chip(!current)}>
            {t('allPosts')}
          </Link>
        </li>
        {shown.map((tag) => (
          <li key={tag}>
            <Link href={blogTagPath(tag)} dir="auto" aria-current={current === tag ? 'page' : undefined} className={chip(current === tag)}>
              {'#'}
              {t(`tags.${BLOG_TAGS[tag]}`)}
            </Link>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <Link href={BLOG_TAGS_INDEX_PATH} className={cn(chip(false), 'gap-1.5 border-dashed font-sans font-semibold text-foreground')}>
              {t('seeAllTopics')}
              <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}

/** The newest post on page 1: a surface panel, cover 7/12 beside the text 5/12, stacked on phones. */
export function FeaturedPost({ loaded }: { loaded: LoadedPost }) {
  const t = useTranslations('blog')
  const locale = useLocale()
  const { post, contentLocale } = loaded
  const lang = contentLocale === locale ? undefined : contentLocale
  return (
    <article
      aria-labelledby={`post-${post.slug}`}
      className={cn(
        'relative mt-8 grid gap-4 bg-surface p-4 sm:mt-12 sm:p-6 lg:grid-cols-12 lg:items-center lg:gap-10',
        CARD_FOCUS
      )}
    >
      {/* On phones the cover runs to the panel's edges, so it's never smaller than a row's. */}
      <Cover
        loaded={loaded}
        eager
        sizes="(min-width: 64rem) 38rem, 100vw"
        className="max-sm:-mx-4 max-sm:-mt-4 max-sm:border-x-0 max-sm:border-t-0 lg:col-span-7"
      />
      <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-5 lg:gap-4 lg:pe-2">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-primary sm:text-[0.8125rem]">{t('latestGuide')}</span>
        <ScheduledFlag post={post} />
        <h2 id={`post-${post.slug}`} lang={lang} className="m-0 text-2xl font-bold leading-tight tracking-tight lg:text-[2rem]">
          <Link href={blogPostPath(post.slug)} className={STRETCHED}>
            <SearchHighlight text={post.title} />
          </Link>
        </h2>
        <p lang={lang} className="m-0 line-clamp-3 leading-relaxed text-text2 sm:text-[1.0625rem]">
          {post.description}
        </p>
        <PostMeta loaded={loaded} className="text-sm sm:text-[0.9375rem]" />
        <TestedOn versions={post.testedOn} lang={lang} id={`tested-on-${post.slug}`} />
        <TagChips tags={post.tags} max={4} moreHref={blogPostPath(post.slug)} size="sm" />
        {/* The card is the link: this only looks like a button. */}
        <span
          aria-hidden="true"
          className="mt-2 hidden min-h-11 items-center gap-2 self-start border border-border2 px-4.5 text-[0.9375rem] font-semibold text-foreground sm:inline-flex"
        >
          {t('readGuideCta')}
          <ArrowRight className="size-4 rtl:-scale-x-100" />
        </span>
      </div>
    </article>
  )
}

/** One post in the "More guides" list: image beside the text (5:7 from lg, 1:1 from 56rem), on top below that. */
export function PostRow({ loaded }: { loaded: LoadedPost }) {
  const locale = useLocale()
  const { post, contentLocale } = loaded
  const lang = contentLocale === locale ? undefined : contentLocale
  return (
    <article
      aria-labelledby={`post-${post.slug}`}
      className={cn(
        // Stacked until an even split leaves the text ~24rem (56rem), then 1:1, then 5:7 from lg.
        'relative grid gap-3 sm:gap-4 sm:p-4 sm:hover:bg-surface min-[56rem]:grid-cols-2 min-[56rem]:items-start min-[56rem]:gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
        CARD_FOCUS
      )}
    >
      <Cover loaded={loaded} sizes="(min-width: 64rem) 28rem, (min-width: 56rem) 50vw, 100vw" />
      <div className="flex min-w-0 flex-col gap-2">
        <ScheduledFlag post={post} />
        <h3 id={`post-${post.slug}`} lang={lang} className="m-0 line-clamp-2 text-lg font-semibold leading-snug sm:text-[1.375rem]">
          <Link href={blogPostPath(post.slug)} className={STRETCHED}>
            <SearchHighlight text={post.title} />
          </Link>
        </h3>
        <p lang={lang} className="m-0 hidden leading-relaxed text-text2 sm:line-clamp-2">
          {post.description}
        </p>
        <PostMeta loaded={loaded} className="text-[0.8125rem] sm:text-sm" />
        <TestedOn versions={post.testedOn} lang={lang} id={`tested-on-${post.slug}`} />
        <TagChips tags={post.tags} max={4} moreHref={blogPostPath(post.slug)} size="sm" />
      </div>
    </article>
  )
}

/** The "More guides" rows of the static page (the heading row comes from the client listing). */
export function PostRows({ posts }: { posts: readonly LoadedPost[] }) {
  return (
    <div className="flex flex-col gap-8 sm:gap-3">
      {posts.map((loaded) => (
        <PostRow key={loaded.post.slug} loaded={loaded} />
      ))}
    </div>
  )
}

/** A few topic links, offered when a search finds nothing. */
export function TopicSuggestions({ tags }: { tags: readonly BlogTag[] }) {
  const t = useTranslations('blog')
  if (tags.length === 0) return null
  return (
    <ul aria-label={t('tagsLabel')} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            href={blogTagPath(tag)}
            dir="auto"
            className="inline-flex min-h-11 items-center border border-border px-3 font-mono text-[0.8125rem] text-text2 no-underline transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9"
          >
            {'#'}
            {t(`tags.${BLOG_TAGS[tag]}`)}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The pager labels from the `blog` messages (server components). */
export function usePagerLabels(): PagerLabels {
  const t = useTranslations('blog')
  return {
    nav: t('pagerLabel'),
    newer: t('newer'),
    older: t('older'),
    pageOf: (page, total) => t('pageOf', { page, total }),
    pageNumber: (page) => t('pageNumber', { page }),
  }
}

/** The server pager (labels from the `blog` messages). */
export function Pager({ page, total, hrefFor }: { page: number; total: number; hrefFor: (page: number) => string }) {
  const labels = usePagerLabels()
  return <PagerView page={page} total={total} hrefFor={hrefFor} labels={labels} />
}
