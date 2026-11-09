/**
 * The site's main navigation links, in order, shared by the header bar (from `lg` up) and the
 * menu panel below `lg` (all links). `label` is a key in the `nav` catalog.
 *
 * `barFromXl`: shown in the header bar only from `xl` (1280px) up. Between `lg` and `xl` five
 * links don't leave 2rem of slack in every language, so the least-needed link steps out there;
 * it stays in the footer (and the menu panel below `lg`).
 */
/**
 * How a header or menu-panel link (`NavLink`) looks while its page is showing: a square teal tint
 * in the primary colour, also while hovered (these replace the base `rounded-lg` and the grey
 * `hover:` classes through `cn`). Contrast of `text-primary` on the tint over `--background`:
 * 4.8:1 light / 8.2:1 dark at rest, 4.6:1 / 7.9:1 hovered. The hover tint stops at 12% because
 * 15% drops light mode to 4.4:1, under AA for this small text.
 *
 * No heavier weight, border or padding: medium Geist is 1-3px wider per label, which would nudge
 * the bar's other links each time the page changes and eat into the lg-to-xl width budget. Lives
 * here, not in the client `NavLink` module, so the server `Navbar` gets the string itself rather
 * than a client reference.
 */
export const NAV_LINK_ACTIVE_CLASS = 'rounded-none bg-primary/10 text-primary hover:bg-primary/12 hover:text-primary'

export const NAV_LINKS: readonly { href: string; label: 'features' | 'pricing' | 'compare' | 'changelog' | 'faq'; barFromXl?: true }[] = [
  { href: '/features', label: 'features' },
  { href: '/pricing', label: 'pricing' },
  { href: '/compare', label: 'compare' },
  { href: '/changelog', label: 'changelog', barFromXl: true },
  { href: '/faq', label: 'faq' },
]
