import { notFound } from 'next/navigation'
import { BlogIndexView, listingMetadata } from '@/components/blog/BlogIndexView'
import { BLOG_TAG_SLUGS, isBlogTag } from '@/lib/blog/tags'

interface TagPageProps {
  params: Promise<{ locale: string; tag: string }>
}

/** One page per tag in the vocabulary (lib/blog/tags.ts); any other tag is a 404. */
export function generateStaticParams() {
  return BLOG_TAG_SLUGS.map((tag) => ({ tag }))
}

export const dynamicParams = false

/**
 * Like the index, English-only while the posts are. A tag with fewer than `TAG_INDEX_MIN_POSTS`
 * posts is a thin page: `noindex, follow` (its post links still count) and not in the sitemap.
 */
export async function generateMetadata({ params }: TagPageProps) {
  const { tag } = await params
  if (!isBlogTag(tag)) return {}
  return listingMetadata(1, tag)
}

/** The posts carrying one tag, newest first, page 1 (later pages: /blog/tags/<tag>/page/<n>). */
export default async function BlogTagPage({ params }: TagPageProps) {
  const { locale, tag } = await params
  if (!isBlogTag(tag)) notFound()
  return BlogIndexView({ locale, page: 1, tag })
}
