import { pageMetadata } from '@/lib/seo'
import { FAQ } from '@/components/marketing/FAQ'

export const metadata = pageMetadata({
  path: '/faq',
  title: 'FAQ',
  description:
    'Frequently asked questions about TabMerger.',
})

export default function FaqPage() {
  return <FAQ />
}
