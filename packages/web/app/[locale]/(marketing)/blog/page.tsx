import { BlogIndexView, listingMetadata } from '@/components/blog/BlogIndexView'

interface BlogIndexProps {
  params: Promise<{ locale: string }>
}

export function generateMetadata() {
  return listingMetadata(1)
}

/**
 * The blog index, page 1: the newest post featured, then "More guides" and the pager
 * (components/blog/BlogIndexView.tsx). Later pages are /blog/page/<n>.
 */
export default async function BlogIndexPage({ params }: BlogIndexProps) {
  const { locale } = await params
  // Called, not rendered as an element: the page stays one awaitable server render (and testable).
  return BlogIndexView({ locale, page: 1 })
}
