import { getTranslations } from 'next-intl/server'
import { ArrowLeft } from 'lucide-react'
import { relevantTags } from '@/components/blog/BlogIndexView'
import { TagDirectory, type DirectoryMessages } from '@/components/blog/TagDirectory'
import { JsonLd } from '@/components/seo/JsonLd'
import { Link } from '@/i18n/navigation'
import { BLOG_PATH } from '@/lib/blog/posts'
import { BLOG_TAGS_INDEX_PATH, blogTagPath } from '@/lib/blog/tags'
import { breadcrumbJsonLd, pageMetadata, SITE_NAME } from '@/lib/seo'

interface TagsIndexProps {
  params: Promise<{ locale: string }>
}

/** Indexable and canonical on the English URL, like the blog index (the blog is English-only). */
export async function generateMetadata() {
  const t = await getTranslations('blog')
  return pageMetadata({ path: BLOG_TAGS_INDEX_PATH, title: t('topicsMetaTitle'), description: t('topicsDescription'), englishOnly: true })
}

/**
 * Every blog topic in use, by relevance (most guides first, then alphabetically), each with its
 * number of articles and a link to its tag page, plus a search field over the labels. Reached
 * from "See all topics" at the end of the topic chips. Counts are the listing's own
 * (`listedTagCounts`), so they match the chips and each tag page's "N guides".
 */
export default async function BlogTagsIndexPage({ params }: TagsIndexProps) {
  const { locale } = await params
  const t = await getTranslations('blog')
  const nav = await getTranslations('nav')
  const entries = await relevantTags(locale)
  const messages: DirectoryMessages = {
    searchLabel: t.raw('topicSearchLabel') as string,
    searchPlaceholder: t.raw('topicSearchPlaceholder') as string,
    clearSearch: t.raw('clearSearch') as string,
    results: t.raw('topicResults') as string,
    noResults: t.raw('topicNoResults') as string,
  }
  return (
    <div className="container max-w-[70rem] pb-20 pt-10 sm:pt-16">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: SITE_NAME, path: '/' },
          { name: nav('blog'), path: BLOG_PATH },
          { name: t('topicsHeading'), path: BLOG_TAGS_INDEX_PATH },
        ])}
      />
      <Link
        href={BLOG_PATH}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-text2 no-underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        {t('allPosts')}
      </Link>
      <header className="mt-2 flex max-w-[44rem] flex-col gap-2.5 sm:gap-3">
        <h1 className="m-0 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">{t('topicsHeading')}</h1>
        <p className="m-0 leading-relaxed text-text2 sm:text-lg">{t('topicsLead')}</p>
      </header>
      <TagDirectory
        locale={locale}
        messages={messages}
        tags={entries.map(({ tag, label, count }) => ({ tag, label, href: blogTagPath(tag), countLabel: t('topicArticles', { count }) }))}
      />
    </div>
  )
}
