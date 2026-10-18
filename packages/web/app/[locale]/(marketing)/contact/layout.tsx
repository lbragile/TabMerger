import { getTranslations } from 'next-intl/server'
import { pageMetadata } from '@/lib/seo'

// The contact page is a client component (the form), and only server modules may export
// metadata, so the page's own title, description and canonical are set here.
export async function generateMetadata() {
  const t = await getTranslations('contact')
  return pageMetadata({ path: '/contact', title: t('metaTitle'), description: t('metaDescription') })
}

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children
}
