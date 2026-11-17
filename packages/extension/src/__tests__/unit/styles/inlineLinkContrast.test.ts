import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { INLINE_LINK } from '@/lib/inlineLink'

/**
 * Links inside a sentence ("See Pro", "Turn on in Settings": `INLINE_LINK`) are underlined (WCAG
 * 1.4.1) and their colour, `--inline-link`, reaches 4.5:1 (1.4.3) on every background they sit on:
 * the main panel (white / the dark background), the sidebar and the sidebar's hover tint, in both
 * themes. Reads the tokens from globals.css, so a token change that breaks it fails here.
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

function over(bg: Rgb, overlay: string): Rgb {
  const [r, g, b, a] = overlay.replace(/rgba\(|\)/g, '').split(',').map(Number)
  const c = [r / 255, g / 255, b / 255]
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
  { theme: 'light', block: ':root' },
  { theme: 'dark', block: '.dark' },
])('inline link contrast ($theme theme)', ({ block }) => {
  const link = hsl(token(block, 'inline-link'))
  const sidebar = hsl(token(block, 'zone-sidebar'))
  const backgrounds = {
    'the main panel': hsl(token(block, 'background')),
    'the sidebar': sidebar,
    'the sidebar hover': over(sidebar, token(block, 'sidebar-hover-bg')),
  }
  it.each(Object.entries(backgrounds))('reaches 4.5:1 on %s', (_name, bg) => {
    expect(ratio(link, bg)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('INLINE_LINK', () => {
  it('is underlined (not told apart by colour alone) and uses the --inline-link colour', () => {
    expect(INLINE_LINK).toMatch(/(^|\s)underline(\s|$)/)
    expect(INLINE_LINK).toContain('text-[hsl(var(--inline-link))]')
  })
})
