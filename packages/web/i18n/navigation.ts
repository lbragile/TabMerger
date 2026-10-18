import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

/**
 * Locale-aware `Link`, `redirect`, `usePathname`, `useRouter` and `getPathname`. Use these for
 * every link to a localized page: on English they render exactly what `next/link` did
 * (`href="/pricing"`), on another locale they add its prefix.
 *
 * Not for `/auth/*`, `/api/*` or other routes outside `app/[locale]/` (they have no prefixed
 * version): link to those with `next/link` or a plain `<a>`.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
