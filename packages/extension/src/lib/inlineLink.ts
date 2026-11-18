/**
 * A link-like button inside a sentence ("See Pro", "Turn on in Settings"). Underlined, so it is not
 * told apart by colour alone (WCAG 1.4.1), in `--inline-link`: 4.5:1 or more on white, the sidebar
 * and its hover in both themes (the shared Button `link` variant's `--primary` is ~3:1 in light).
 * Font size comes from the sentence. A plain `<button>`: no Button variant classes to merge.
 */
export const INLINE_LINK =
  'inline cursor-pointer p-0 text-start align-baseline text-[hsl(var(--inline-link))] underline underline-offset-2 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
