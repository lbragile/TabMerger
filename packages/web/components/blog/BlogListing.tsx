import Image from 'next/image'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { TagChips } from '@/components/blog/TagChips'
import { TestedOn } from '@/components/blog/TestedOn'
import { Link } from '@/i18n/navigation'
import { BLOG_PATH, blogPostPath, isRevised, shownDate, type LoadedPost } from '@/lib/blog/posts'
import { BLOG_TAGS, blogTagPath, type BlogTag } from '@/lib/blog/tags'
import { cn } from '@/lib/utils'

/**
 * The blog index and tag pages (design A): topic chips, the newest post as a featured panel on
 * page 1, then the "More guides" rows, then the pager. Every card is one link (its title, stretched
 * over the card with `::after`); tag chips sit above it and stay links of their own. No rules
 * between rows: spacing only.
 */

/** Keyboard focus on the title link outlines the whole card. */
const CARD_FOCUS = 'has-[.post-link:focus-visible]:outline-2 has-[.post-link:focus-visible]:outline-offset-2 has-[.post-link:focus-visible]:outline-ring'
const STRETCHED = 'post-link after:absolute after:inset-0 hover:text-primary focus-visible:outline-none'

/** "Nov 19, 2026 · 4 min read" (or "Updated <date>" once revised). */
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
    </p>
  )
}

/** The post's first capture, 16:9, top-aligned; decorative (the title names the card). */
function Cover({ loaded, eager, className }: { loaded: LoadedPost; eager?: boolean; className?: string }) {
  const cover = loaded.post.images[0]
  return (
    <div className={cn('relative aspect-video overflow-hidden border border-border bg-surface2', className)}>
      <Image unoptimized src={cover.src} alt="" fill sizes="(min-width: 64rem) 40rem, 100vw" loading={eager ? 'eager' : 'lazy'} className="object-cover object-top" />
    </div>
  )
}

/** "All posts" and the most-used tags; the current one (index or tag) is marked. */
export function TopicChips({ tags, current }: { tags: readonly BlogTag[]; current?: BlogTag }) {
  const t = useTranslations('blog')
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
        {tags.map((tag) => (
          <li key={tag}>
            <Link href={blogTagPath(tag)} dir="auto" aria-current={current === tag ? 'page' : undefined} className={chip(current === tag)}>
              {'#'}
              {t(`tags.${BLOG_TAGS[tag]}`)}
            </Link>
          </li>
        ))}
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
      className={cn('relative mt-8 grid gap-4 bg-surface p-4 sm:mt-12 sm:p-6 lg:grid-cols-12 lg:items-center lg:gap-10', CARD_FOCUS)}
    >
      <Cover loaded={loaded} eager className="lg:col-span-7" />
      <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-5 lg:gap-4 lg:pe-2">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-primary sm:text-[0.8125rem]">{t('latestGuide')}</span>
        <h2 id={`post-${post.slug}`} lang={lang} className="m-0 text-2xl font-bold leading-tight tracking-tight lg:text-[2rem]">
          <Link href={blogPostPath(post.slug)} className={STRETCHED}>
            {post.title}
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

/** One post in the "More guides" list: thumbnail beside the text; image on top on phones. */
export function PostRow({ loaded }: { loaded: LoadedPost }) {
  const locale = useLocale()
  const { post, contentLocale } = loaded
  const lang = contentLocale === locale ? undefined : contentLocale
  return (
    <article
      aria-labelledby={`post-${post.slug}`}
      className={cn(
        'relative grid gap-2.5 transition-colors sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-start sm:gap-7 sm:p-4 sm:hover:bg-surface',
        CARD_FOCUS
      )}
    >
      <Cover loaded={loaded} />
      <div className="flex min-w-0 flex-col gap-2">
        <h3 id={`post-${post.slug}`} lang={lang} className="m-0 line-clamp-2 text-lg font-semibold leading-snug sm:text-[1.375rem]">
          <Link href={blogPostPath(post.slug)} className={STRETCHED}>
            {post.title}
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

/** "More guides": the posts after the featured one (all of them on later pages). */
export function PostList({ posts }: { posts: readonly LoadedPost[] }) {
  const t = useTranslations('blog')
  if (posts.length === 0) return null
  return (
    <section aria-labelledby="more-guides" className="mt-10 sm:mt-16">
      <h2 id="more-guides" className="mb-3 mt-0 font-mono text-xs font-medium uppercase tracking-[0.08em] text-text3 sm:mb-5 sm:text-[0.8125rem]">
        {t('moreGuides')}
      </h2>
      <div className="flex flex-col gap-8 sm:gap-4">
        {posts.map((loaded) => (
          <PostRow key={loaded.post.slug} loaded={loaded} />
        ))}
      </div>
    </section>
  )
}

/**
 * "← Newer", the page numbers ("Page X of Y" on phones) and "Older →". An end with nowhere to go
 * is shown but unavailable (a span with `aria-disabled`, not a link). Hidden with a single page.
 */
export function Pager({ page, total, hrefFor }: { page: number; total: number; hrefFor: (page: number) => string }) {
  const t = useTranslations('blog')
  if (total <= 1) return null
  const end = 'inline-flex min-h-11 items-center gap-2 px-1 text-[0.9375rem] sm:px-4'
  const newer = (
    <>
      <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      {t('newer')}
    </>
  )
  const older = (
    <>
      {t('older')}
      <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
    </>
  )
  const link = 'border border-border2 font-semibold text-foreground no-underline hover:bg-surface3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  return (
    <nav aria-label={t('pagerLabel')} className="mt-10 flex flex-wrap items-center justify-between gap-2 sm:mt-14 sm:gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={cn(end, link, 'px-4')}>
          {newer}
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(end, 'text-text3 opacity-60')}>
          {newer}
        </span>
      )}
      <ol className="m-0 hidden list-none gap-1 p-0 sm:flex">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <li key={n}>
            <Link
              href={hrefFor(n)}
              aria-current={n === page ? 'page' : undefined}
              aria-label={t('pageNumber', { page: n })}
              className={cn(
                'flex size-11 items-center justify-center tabular-nums no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                n === page ? 'bg-accent font-semibold text-accent-foreground' : 'text-text2 hover:bg-surface3 hover:text-foreground'
              )}
            >
              {n}
            </Link>
          </li>
        ))}
      </ol>
      <span className="text-sm text-text3 sm:hidden">{t('pageOf', { page, total })}</span>
      {page < total ? (
        <Link href={hrefFor(page + 1)} rel="next" className={cn(end, link, 'px-4')}>
          {older}
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(end, 'text-text3 opacity-60')}>
          {older}
        </span>
      )}
    </nav>
  )
}

/** The page body under the header: featured (page 1 of the index), the list, the pager. */
export function BlogListing({
  posts,
  page,
  total,
  hrefFor,
  featured,
}: {
  posts: readonly LoadedPost[]
  page: number
  total: number
  hrefFor: (page: number) => string
  /** Show the first post as the featured panel (page 1 of the index only). */
  featured: boolean
}) {
  const [first, ...rest] = posts
  return (
    <>
      {featured && first ? <FeaturedPost loaded={first} /> : null}
      <PostList posts={featured ? rest : posts} />
      <Pager page={page} total={total} hrefFor={hrefFor} />
    </>
  )
}
