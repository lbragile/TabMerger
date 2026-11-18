import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AUTO_ITEM_COLORS, PRESET_COLORS } from '@tabmerger/shared'
import { contrastRatio, parseRgba, readableTextColor } from '@/lib/color'

/**
 * Contrast in the read-only session and archived views, for every palette colour in both themes:
 * - a window's number tile is drawn in its group's colour (opaque, so the same in both themes)
 *   with black or white text from `readableTextColor`: at least 4.5:1;
 * - the session header's bookmark icon on its tinted tile (`.tm-session-tile`, which mixes the
 *   session colour into the background for the fill and into black for the icon, by theme
 *   tokens): at least 3:1 (WCAG 1.4.11, a graphic);
 * - every solid primary fill with a text label (Button and Badge default variants, Restore) on the
 *   `--primary-solid` tokens, at rest and on hover;
 * - the muted 10-11px text beside them (tab counts, group counts, "End of session") on the panel.
 * Reads the tokens from globals.css, so a token change that breaks one of these fails here.
 */

const css = readFileSync(path.resolve(__dirname, '../../../styles/globals.css'), 'utf-8')

type Rgb = [number, number, number]

function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('}', start))
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`))
  expect(match, `--${name} in ${selector}`).not.toBeNull()
  return match![1].trim()
}

/** An `H S% L%` token as 0..255 RGB. */
function hsl(value: string): Rgb {
  const [h, s, l] = value.replace(/%/g, '').split(/\s+/).map(Number)
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

const percent = (value: string) => Number(value.replace('%', '')) / 100
/** `color-mix(in srgb, a p, b)` for opaque colours. */
const mix = (a: Rgb, p: number, b: Rgb): Rgb => [0, 1, 2].map((i) => a[i] * p + b[i] * (1 - p)) as Rgb
const css3 = ([r, g, b]: Rgb) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 1)`
const rgb = (color: string): Rgb => {
  const { r, g, b } = parseRgba(color)
  return [r, g, b]
}
const BLACK: Rgb = [0, 0, 0]

const THEMES = [
  { theme: 'light', block: ':root' },
  { theme: 'dark', block: '.dark' },
] as const

describe.each(THEMES)('session view contrast ($theme theme)', ({ block }) => {
  const background = hsl(token(block, 'background'))

  it.each([...PRESET_COLORS])('the window number tile in %s has text at 4.5:1 or more', (color) => {
    expect(contrastRatio(readableTextColor(color), color)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([...AUTO_ITEM_COLORS])('the bookmark icon in %s is at 3:1 or more on its tile', (color) => {
    const tile = mix(rgb(color), percent(token(block, 'session-tile-fill')), background)
    const icon = mix(rgb(color), percent(token(block, 'session-tile-icon')), BLACK)
    expect(contrastRatio(css3(icon), css3(tile))).toBeGreaterThanOrEqual(3)
  })

  it('solid primary buttons have their label at 4.5:1 or more on the solid token', () => {
    const fill = css3(hsl(token(block, 'primary-solid')))
    const label = css3(hsl(token(block, 'primary-solid-foreground')))
    expect(contrastRatio(label, fill)).toBeGreaterThanOrEqual(4.5)
  })

  it('solid primary buttons keep their label at 4.5:1 or more on hover', () => {
    const label = css3(hsl(token(block, 'primary-solid-foreground')))
    // The hover token may carry an alpha (`H S% L% / 0.9`): composite it over the page background
    const [colour, alpha] = token(block, 'primary-solid-hover').split('/').map((part) => part.trim())
    const over = hsl(colour)
    const hover = alpha === undefined ? over : mix(over, Number(alpha), background)
    expect(contrastRatio(label, css3(hover))).toBeGreaterThanOrEqual(4.5)
  })

  it('muted counts and the end line are at 4.5:1 or more on the panel', () => {
    expect(contrastRatio(css3(hsl(token(block, 'muted-foreground'))), css3(background))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('theme values of the session view', () => {
  it('solid fills need their own token in the light theme: white on --primary is under 4.5:1', () => {
    expect(contrastRatio('#ffffff', css3(hsl(token(':root', 'primary'))))).toBeLessThan(4.5)
    // and the dark theme keeps the primary look, at rest and on hover (the old `bg-primary/90`)
    expect(token('.dark', 'primary-solid')).toBe(token('.dark', 'primary'))
    expect(token('.dark', 'primary-solid-foreground')).toBe(token('.dark', 'primary-foreground'))
    expect(token('.dark', 'primary-solid-hover')).toBe(`${token('.dark', 'primary')} / 0.9`)
  })

  it('--primary stays the brand accent: unchanged in both themes', () => {
    expect(token(':root', 'primary')).toBe('193 100% 40%')
    expect(token('.dark', 'primary')).toBe('193 80% 55%')
  })

  it('the light theme darkens the icon (the colour alone is too faint on white) and keeps it pure in the dark', () => {
    expect(percent(token(':root', 'session-tile-icon'))).toBeLessThan(1)
    expect(percent(token('.dark', 'session-tile-icon'))).toBe(1)
    // yellow alone on its light tile would fail
    const yellow = rgb('rgba(234, 179, 8, 1)')
    const tile = mix(yellow, percent(token(':root', 'session-tile-fill')), [255, 255, 255])
    expect(contrastRatio(css3(yellow), css3(tile))).toBeLessThan(3)
  })

  it('the rail is stronger on white than on the dark panel', () => {
    expect(percent(token(':root', 'bracket-rail'))).toBeGreaterThan(percent(token('.dark', 'bracket-rail')))
  })

  it('one sticky offset token sizes the group header', () => {
    expect(token(':root', 'section-group-header')).toMatch(/rem$/)
  })
})
