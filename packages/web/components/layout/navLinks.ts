/**
 * The site's main navigation links, in order, shared by the header bar (from `md` up) and the
 * mobile menu panel (all links). `label` is a key in the `nav` catalog.
 *
 * `barFromXl`: shown in the header bar only from `xl` (1280px) up. With five links the bar ran out
 * of room between `md` and `xl` in German, Russian, French and Polish (measured 2026-11-07: up to
 * 120px too wide at 768, 77px at 1024), so the least-needed link steps out there; it stays in
 * the footer and the mobile menu.
 */
export const NAV_LINKS: readonly { href: string; label: 'features' | 'pricing' | 'compare' | 'changelog' | 'faq'; barFromXl?: true }[] = [
  { href: '/features', label: 'features' },
  { href: '/pricing', label: 'pricing' },
  { href: '/compare', label: 'compare' },
  { href: '/changelog', label: 'changelog', barFromXl: true },
  { href: '/faq', label: 'faq' },
]
