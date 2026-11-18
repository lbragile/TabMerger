import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The recently-closed hour strip's bars are drawn in the day's colour, which can be a light orange,
 * yellow, green, cyan or teal under 3:1 on white (and a dimmed bar is fainter still). So every bar
 * has a 1px outline in `--muted-foreground`, never dimmed: that outline must reach 3:1 (WCAG
 * 1.4.11, non-text contrast) on the main panel in both themes, whatever the day's colour. Reads
 * the tokens from globals.css, so a token change that breaks it fails here.
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

function hsl(value: string): Rgb {
  const [h, s, l] = value.replace(/%/g, '').split(/\s+/).map(Number)
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

function luminance([r, g, b]: Rgb): number {
  const c = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

describe.each([
  { theme: 'light', block: ':root' },
  { theme: 'dark', block: '.dark' },
])('hour strip bar outline ($theme theme)', ({ block }) => {
  it('the outline (--muted-foreground) is at least 3:1 on the main panel', () => {
    expect(ratio(hsl(token(block, 'muted-foreground')), hsl(token(block, 'background')))).toBeGreaterThanOrEqual(3)
  })
})

describe('why the outline is needed', () => {
  it('a light-theme cyan day colour alone is under 3:1 on white', () => {
    // cyan-500, one of the day colours (AUTO_ITEM_COLORS)
    expect(ratio(rgb('#06b6d4'), [1, 1, 1])).toBeLessThan(3)
  })
})
