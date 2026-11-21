import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { faqJsonLd, pageMetadata } from '@/lib/seo'
import { faqItems } from '@/lib/faq'
import { FAQ } from '@/components/marketing/FAQ'
import { JsonLd } from '@/components/seo/JsonLd'
import { PageBreadcrumbJsonLd } from '@/components/seo/PageBreadcrumbJsonLd'

export async function generateMetadata() {
  const t = await getTranslations('faq')
  return pageMetadata({ path: '/faq', title: t('metaTitle'), description: t('metaDescription') })
}

/**
 * The FAQ as FAQPage structured data, from the same items `FAQ` renders, in the request's
 * language, and the page's breadcrumb trail.
 */
function FaqJsonLd() {
  const t = useTranslations('faq')
  const nav = useTranslations('nav')
  return (
    <>
      <JsonLd data={faqJsonLd(faqItems(t))} />
      <PageBreadcrumbJsonLd path="/faq" name={nav('faq')} />
    </>
  )
}

export default function FaqPage() {
  return (
    <>
      <FaqJsonLd />
      <FAQ />
    </>
  )
}
