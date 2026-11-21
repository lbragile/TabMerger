import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ArticleBar } from '@/components/blog/ArticleBar'
import { BlogPostStateProvider } from '@/components/blog/BlogPostState'
import { FigureLightbox } from '@/components/blog/FigureLightbox'
import { KeyFacts } from '@/components/blog/KeyFacts'
import { PostNav } from '@/components/blog/PostNav'
import { PostSources } from '@/components/blog/PostSources'
import { ScrollReveal } from '@/components/blog/ScrollReveal'
import { TagChips } from '@/components/blog/TagChips'
import { TestedOn } from '@/components/blog/TestedOn'
import { JsonLd } from '@/components/seo/JsonLd'
import { Toc } from '@/components/toc'
import { DEFAULT_LOCALE, localeDirection, localizedPath } from '@/i18n/locales'
import { blogPostingJsonLd } from '@/lib/blog/jsonLd'
import { blogPostMetadata } from '@/lib/blog/metadata'
import { adjacentPosts, BLOG_AUTHOR, BLOG_PATH, BLOG_SLUGS, blogPostPath, isPlaceholder, isPublished, isRevised, loadPost, shownDate } from '@/lib/blog/posts'
import { isProductionDeployment } from '@/lib/deployment'
import { hashtagWord, type ShareContent } from '@/lib/blog/share'
import { tagKeywords } from '@/lib/blog/tagLabels'
import { BLOG_TAGS } from '@/lib/blog/tags'
import { GITHUB_REPO_URL } from '@/lib/github'
import { DOWNLOAD_PATH } from '@/lib/download'
import { breadcrumbJsonLd, faqJsonLd, SITE_NAME } from '@/lib/seo'
import { getMetadataBase } from '@/lib/utils'
import '../blog.css'

interface PostPageProps {
  params: Promise<{ locale: string; slug: string }>
}

/** One page per post (and per locale, from the `[locale]` layout); any other slug is a 404. */
export function generateStaticParams() {
  return BLOG_SLUGS.map((slug) => ({ slug }))
}

export const dynamicParams = false

export async function generateMetadata({ params }: PostPageProps) {
  const { locale, slug } = await params
  const loaded = await loadPost(slug, locale)
  if (!loaded) return {}
  const metadata = await blogPostMetadata(loaded, locale, await tagKeywords(loaded.post.tags, loaded.contentLocale))
  // A scheduled post previewed before its date, and a dev-only placeholder, are never indexed.
  return isPublished(loaded.post) && !isPlaceholder(slug) ? metadata : { ...metadata, robots: { index: false, follow: false } }
}

/**
 * A blog post: contents (sticky from 64rem), the article (header, tags, Helpful/Share bar, MDX
 * body, sources) and the rail (under the article up to 80rem, a sticky third column from there).
 * Reads no request headers or cookies, so it never renders per request on its own account: the
 * reader's browser, theme and session are read in the browser after hydration.
 *
 * A locale without its own file shows the English one, marked `lang="en"` inside the page; the
 * page's own words (contents heading, byline, buttons) follow the site's language.
 */
export default async function BlogPostPage({ params }: PostPageProps) {
  const { locale, slug } = await params
  const loaded = await loadPost(slug, locale)
  if (!loaded) notFound()
  const { post, Content, contentLocale, readMinutes } = loaded
  // A post merged before its date: not public on production; previewable everywhere else.
  const scheduled = !isPublished(post)
  if (scheduled && isProductionDeployment()) notFound()

  const t = await getTranslations('blog')
  const nav = await getTranslations('nav')
  const format = await getFormatter()

  const ownFile = contentLocale === locale
  const urlLocale = ownFile ? locale : DEFAULT_LOCALE
  // The URL this content is canonical at: the English one when this locale has no file.
  const canonicalPath = localizedPath(urlLocale, blogPostPath(slug))
  const pagePath = localizedPath(locale, blogPostPath(slug))
  const shareUrl = new URL(canonicalPath, getMetadataBase()).href
  const contentLang = ownFile ? undefined : contentLocale
  const contentDir = contentLang && localeDirection(contentLocale) !== localeDirection(locale) ? localeDirection(contentLocale) : undefined
  // The publication date, or "Updated <date>" once the post has been revised since.
  const dateIso = shownDate(post)
  const date = format.dateTime(new Date(`${dateIso}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })
  const base = getMetadataBase()
  const tagsT = await getTranslations('blog.tags')
  const share: ShareContent = {
    url: shareUrl,
    title: post.title,
    description: post.description,
    summary: post.shareSummary,
    hashtags: post.tags.slice(0, 3).map((tag) => hashtagWord(tagsT(BLOG_TAGS[tag]))),
    origin: base.origin,
    // One short install link that picks the reader's store (app/download/route.ts).
    downloadUrl: new URL(DOWNLOAD_PATH, base).href,
    githubUrl: GITHUB_REPO_URL,
  }
  const toc = post.sources.length > 0 ? [...post.toc, { id: 'sources', label: t('sources') }] : post.toc

  return (
    <BlogPostStateProvider browserSections={post.browserSections}>
      <FigureLightbox>
        <JsonLd data={blogPostingJsonLd(post, canonicalPath, contentLocale, await tagKeywords(post.tags, contentLocale))} />
        <JsonLd data={faqJsonLd(post.faq)} />
        <JsonLd
          data={breadcrumbJsonLd([
            { name: SITE_NAME, path: localizedPath(urlLocale, '/') },
            { name: nav('blog'), path: localizedPath(urlLocale, BLOG_PATH) },
            { name: post.title, path: canonicalPath },
          ])}
        />
        <div className="container max-w-[87.5rem] pb-16 pt-8">
          <a
            href="#article"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-foreground focus:px-4 focus:py-3 focus:text-background"
          >
            {t('skipToArticle')}
          </a>
          {/* Both sticky columns are grid items: they stop at the end of this grid (the article),
              never over the footer. */}
          <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,46rem)_20rem] xl:gap-x-10">
            <div lang={contentLang} dir={contentDir} className="hidden lg:block lg:self-stretch">
              <Toc variant="article" items={toc} heading={t('onThisPage')} />
            </div>

            <article id="article" className="blog-article min-w-0 scroll-mt-24" aria-labelledby="post-title">
              {scheduled && (
                <p role="note" className="mb-6 border border-secondary/40 bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground dark:bg-secondary/10 dark:text-secondary">
                  {t('scheduled', {
                    date: format.dateTime(new Date(`${post.published}T00:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' }),
                  })}
                </p>
              )}
              <header lang={contentLang} dir={contentDir}>
                <h1 id="post-title" className="mb-4 text-[clamp(2rem,4.2vw,2.875rem)] font-bold leading-[1.08] tracking-tight">
                  {post.title}
                </h1>
                <p className="mb-5 text-lg leading-relaxed text-text2">{post.dek}</p>
              </header>
              <p className="mb-3 text-[0.9375rem] text-text2">
                {t.rich(isRevised(post) ? 'bylineUpdated' : 'byline', {
                  name: BLOG_AUTHOR.name,
                  date,
                  author: (chunks) => (
                    <a href={BLOG_AUTHOR.url} rel="author" className="font-semibold text-foreground underline underline-offset-4">
                      {chunks}
                    </a>
                  ),
                  time: (chunks) => <time dateTime={dateIso}>{chunks}</time>,
                })}
              </p>
              <TestedOn versions={post.testedOn} lang={contentLang} className="mb-3" />
              <TagChips tags={post.tags} className="mb-5" />
              {contentLang && <p className="mb-4 text-sm text-text3">{t('englishOnly')}</p>}
              <ArticleBar
                slug={slug}
                readTime={t('readTime', { minutes: readMinutes })}
                share={share}
                returnPath={`${pagePath}#helpful`}
              />

              <details className="mb-2 mt-6 border border-border bg-surface2 lg:hidden">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold">{t('onThisPage')}</summary>
                <ol lang={contentLang} dir={contentDir} className="m-0 list-none border-t border-border px-2 py-2">
                  {toc.map((item) => (
                    <li key={item.id}>
                      <a href={`#${item.id}`} className="flex min-h-11 items-center px-2 text-text2 hover:text-foreground">
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </details>

              <div lang={contentLang} dir={contentDir}>
                <Content />
              </div>
              <PostSources post={post} contentLang={contentLang} />
              <PostNav {...adjacentPosts(slug, locale)} />
              <ScrollReveal />
            </article>

            <div className="min-w-0 lg:col-start-2 xl:sticky xl:top-22 xl:col-start-3 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
              <KeyFacts post={post} contentLang={contentLang} />
            </div>
          </div>
        </div>
      </FigureLightbox>
    </BlogPostStateProvider>
  )
}
