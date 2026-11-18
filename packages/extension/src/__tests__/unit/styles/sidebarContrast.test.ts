import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The sidebar's small muted text (10px detail lines, badge counts, footer stats) must reach 4.5:1
 * (WCAG 1.4.3) on every background a sidebar row can have: plain, hover, current, and a count
 * badge on the current row. Reads the tokens from globals.css and computes the ratios, so a token
 * change that drops one under 4.5:1 fails here.
 */

const css = readFileSync(path.resolve(__dirname, '../../../styles/globals.css'), 'utf-8')

type Rgb = [number, number, number]

/** The value of `--name:` inside the first block that `selector` opens. */
function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('}', start))
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`))
  expect(match, `--${name} in ${selector}`).not.toBeNull()
  return match![1].trim()
}

function hsl(value: string): Rgb {
  const [h, s, l] = value.replace(/%/g, '').split(/\s+/).map(Number)
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

const hex = (value: string): Rgb => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as Rgb

/** An `rgba(r,g,b,a)` overlay as [colour, alpha]. */
function rgba(value: string): [Rgb, number] {
  const [r, g, b, a] = value.replace(/rgba\(|\)/g, '').split(',').map(Number)
  return [[r / 255, g / 255, b / 255], a]
}

const over = (bg: Rgb, overlay: string): Rgb => {
  const [c, a] = rgba(overlay)
  return bg.map((v, i) => v * (1 - a) + c[i] * a) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const c = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe.each([
  { theme: 'light', themeBlock: ':root', sidebarBlock: '.tm-sidebar' },
  { theme: 'dark', themeBlock: '.dark', sidebarBlock: '.dark .tm-sidebar' },
])('sidebar muted text contrast ($theme theme)', ({ themeBlock, sidebarBlock }) => {
  const plain = hsl(token(themeBlock, 'zone-sidebar'))
  const hover = over(plain, token(themeBlock, 'sidebar-hover-bg'))
  const current = over(plain, token(themeBlock, 'sidebar-current-bg'))
  const badge = token(themeBlock, 'sidebar-badge-bg')
  const rows = { plain, hover, current }
  // the count badges add their own tint, on any row
  const backgrounds = { ...rows, 'badge on a plain row': over(plain, badge), 'badge on the current row': over(current, badge) }

  // detail lines and labels (`text-muted-foreground`) sit on the rows, never on a badge
  it.each(Object.entries(rows))('the sidebar muted-foreground reaches 4.5:1 on %s', (_name, bg) => {
    expect(ratio(hsl(token(sidebarBlock, 'muted-foreground')), bg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries(backgrounds))('--sidebar-text-muted (counts, footer) reaches 4.5:1 on %s', (_name, bg) => {
    expect(ratio(hex(token(themeBlock, 'sidebar-text-muted')), bg)).toBeGreaterThanOrEqual(4.5)
  })
})
