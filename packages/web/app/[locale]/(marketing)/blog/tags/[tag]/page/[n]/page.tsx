import { notFound } from 'next/navigation'
import { BlogIndexView, listingMetadata, resolveListingPage } from '@/components/blog/BlogIndexView'
import { laterPages } from '@/lib/blog/paging'
import { BLOG_SOURCES, indexableSlugs } from '@/lib/blog/posts'
import { BLOG_TAG_SLUGS, isBlogTag } from '@/lib/blog/tags'

interface TagPageProps {
  params: Promise<{ locale: string; tag: string; n: string }>
}

/** Pages 2 and up of each tag (page 1 is /blog/tags/<tag>; /…/page/1 redirects there). */
export function generateStaticParams() {
  return BLOG_TAG_SLUGS.flatMap((tag) => {
    const count = indexableSlugs().filter((slug) => BLOG_SOURCES[slug].en?.tags.includes(tag)).length
    return laterPages(count).map((n) => ({ tag, n: String(n) }))
  })
}

export async function generateMetadata({ params }: TagPageProps) {
  const { locale, tag, n } = await params
  if (!isBlogTag(tag)) return {}
  return listingMetadata(await resolveListingPage(n, locale, tag), tag)
}

export default async function BlogTagLaterPage({ params }: TagPageProps) {
  const { locale, tag, n } = await params
  if (!isBlogTag(tag)) notFound()
  const page = await resolveListingPage(n, locale, tag)
  return BlogIndexView({ locale, page, tag })
}
