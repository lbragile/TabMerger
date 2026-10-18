import { getTranslations } from 'next-intl/server'
import { pageMetadata } from '@/lib/seo'
import { FAQ } from '@/components/marketing/FAQ'

export async function generateMetadata() {
  const t = await getTranslations('faq')
  return pageMetadata({ path: '/faq', title: t('metaTitle'), description: t('metaDescription') })
}

export default function FaqPage() {
  return <FAQ />
}
