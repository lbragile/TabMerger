'use client'

import dynamic from 'next/dynamic'

export const DemoSectionLoader = dynamic(
  () => import('./DemoSection').then((m) => m.DemoSection),
  { ssr: false }
)
