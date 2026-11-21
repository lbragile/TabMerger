import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { pageMetadata } from '@/lib/seo'
import { PageBreadcrumbJsonLd } from '@/components/seo/PageBreadcrumbJsonLd'

// The contact page is a client component (the form), and only server modules may export
// metadata, so the page's own title, description and canonical are set here.
export async function generateMetadata() {
  const t = await getTranslations('contact')
  return pageMetadata({ path: '/contact', title: t('metaTitle'), description: t('metaDescription') })
}

// The page is a client component, so its breadcrumb structured data is rendered here too.
export default function ContactLayout({ children }: { children: React.ReactNode }) {
  const footer = useTranslations('footer')
  return (
    <>
      <PageBreadcrumbJsonLd path="/contact" name={footer('contact')} />
      {children}
    </>
  )
}
