import type { Metadata } from 'next'
import { FAQ } from '@/components/marketing/FAQ'

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Frequently asked questions about TabMerger.',
}

export default function FaqPage() {
  return <FAQ />
}
