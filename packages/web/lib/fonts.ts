import { Geist, Geist_Mono, Noto_Sans_Arabic, Noto_Sans_Hebrew } from 'next/font/google'

/**
 * The site's fonts. Geist covers Latin, Cyrillic and Vietnamese; it has no Arabic or Hebrew
 * glyphs, so the right-to-left locales add a script font after it in the stack
 * (`--font-sans` in globals.css: Geist, then `--font-script`). Latin words, brand names and
 * Latin digits inside an Arabic or Hebrew page keep Geist; the script's own letters come from
 * the script font.
 *
 * The script fonts are `preload: false` and their class (which defines `--font-script`) is only
 * put on `<body>` for their locales (`scriptFontClass`). Every visitor gets their `@font-face`
 * rules (a few hundred bytes of CSS), but a browser only downloads a face that some rendered
 * text uses, and each face is limited to its script's `unicode-range`, so a left-to-right
 * visitor downloads none of them.
 *
 * - Arabic and Persian: Noto Sans Arabic, the sans companion to Geist (covers Persian letters
 *   and Persian digits).
 * - Hebrew: Noto Sans Hebrew.
 *
 * Unit tests mock `next/font/google` (it is a compiler transform, not runnable in Vitest).
 */
export const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

export const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-script',
  preload: false,
})

const notoSansHebrew = Noto_Sans_Hebrew({
  subsets: ['hebrew'],
  variable: '--font-script',
  preload: false,
})

/** Script font per right-to-left locale. Keys are base language codes. */
const SCRIPT_FONTS: Record<string, { variable: string }> = {
  ar: notoSansArabic,
  fa: notoSansArabic,
  he: notoSansHebrew,
}

/**
 * The class that turns on a locale's script font, or '' for a locale Geist covers. Matched on
 * the language subtag, so a regional tag (`ar-EG`) gets its language's font.
 */
export function scriptFontClass(locale: string): string {
  return SCRIPT_FONTS[locale.split('-')[0].toLowerCase()]?.variable ?? ''
}
