import { BlogIndexView, listingMetadata, resolveListingPage } from '@/components/blog/BlogIndexView'
import { laterPages } from '@/lib/blog/paging'
import { indexableSlugs } from '@/lib/blog/posts'

interface BlogPageProps {
  params: Promise<{ locale: string; n: string }>
}

/** Pages 2 and up of the blog index (page 1 is /blog; /blog/page/1 redirects there). */
export function generateStaticParams() {
  return laterPages(indexableSlugs().length).map((n) => ({ n: String(n) }))
}

export async function generateMetadata({ params }: BlogPageProps) {
  const { locale, n } = await params
  return listingMetadata(await resolveListingPage(n, locale))
}

export default async function BlogIndexLaterPage({ params }: BlogPageProps) {
  const { locale, n } = await params
  const page = await resolveListingPage(n, locale)
  return BlogIndexView({ locale, page })
}
