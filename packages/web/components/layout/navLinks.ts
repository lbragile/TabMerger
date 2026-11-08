/**
 * The site's main navigation links, in order, shared by the header bar (from `lg` up) and the
 * menu panel below `lg` (all links). `label` is a key in the `nav` catalog.
 *
 * `barFromXl`: shown in the header bar only from `xl` (1280px) up. Between `lg` and `xl` five
 * links don't leave 2rem of slack in every language, so the least-needed link steps out there;
 * it stays in the footer (and the menu panel below `lg`).
 */
export const NAV_LINKS: readonly { href: string; label: 'features' | 'pricing' | 'compare' | 'changelog' | 'faq'; barFromXl?: true }[] = [
  { href: '/features', label: 'features' },
  { href: '/pricing', label: 'pricing' },
  { href: '/compare', label: 'compare' },
  { href: '/changelog', label: 'changelog', barFromXl: true },
  { href: '/faq', label: 'faq' },
]
