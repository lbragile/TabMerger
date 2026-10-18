'use client'

import dynamic from 'next/dynamic'
import { PUBLIC_LOCALES } from '@/i18n/locales'
import type { LanguageMenuProps } from '@/components/layout/LanguageMenu'

// A client-side dynamic import, like AccountMenuLoader: the marketing pages otherwise ship no
// Radix menu code, so the menu's chunk loads separately from the page's first-load JavaScript.
const LanguageMenu = dynamic(() => import('@/components/layout/LanguageMenu').then((m) => m.LanguageMenu))

/**
 * The site's language picker, in the marketing navbar (and its mobile panel) and the signed-in
 * app header, beside the theme toggle. Switching keeps the current page (`/pricing` ->
 * `/es/pricing`, query string and hash too) and stores the choice in the `NEXT_LOCALE` cookie;
 * see `LanguageMenu`.
 *
 * Renders nothing while only one language is public.
 */
export function LanguageSwitcher(props: LanguageMenuProps) {
  if (PUBLIC_LOCALES.length < 2) return null
  return <LanguageMenu {...props} />
}
