import { describe, expect, it } from 'vitest'
import { PSEUDO_LOCALE, pseudoLocalizeCatalog, pseudoLocalizeText } from '@/lib/pseudoLocale'

describe('pseudoLocalizeText', () => {
  it('accents letters and pads about 35% inside brackets', () => {
    // 8 visible characters: ceil(8 * 0.35) = 3 extra, two of them the brackets
    expect(pseudoLocalizeText('Undo all')).toBe('[Ûñðö àļļ·]')
  })

  it('breaks long padding into runs of 8 so the text can still wrap', () => {
    const out = pseudoLocalizeText('x'.repeat(100))
    const padding = out.slice(101, -1)
    expect(padding.split(' ').every((run) => run.length > 0 && run.length <= 8)).toBe(true)
    expect(padding.replace(/ /g, '')).toHaveLength(Math.ceil(100 * 0.35) - 2)
  })

  it('keeps interpolations and Trans tags verbatim', () => {
    const out = pseudoLocalizeText('Move {{name}} to <strong>{{group}}</strong><br/>')
    expect(out).toContain('{{name}}')
    expect(out).toContain('<strong>{{group}}</strong>')
    expect(out).toContain('<br/>')
    expect(out).toContain('Ṁöṽé')
  })

  it('leaves digits and symbols alone and still brackets an empty string', () => {
    expect(pseudoLocalizeText('Ctrl K · 3')).toMatch(/^\[Çţŕļ Ķ · 3·*\]$/)
    expect(pseudoLocalizeText('')).toBe('[]')
  })
})

describe('pseudoLocalizeCatalog', () => {
  it('rewrites every string, keeping keys and nesting', () => {
    const out = pseudoLocalizeCatalog({ a: 'Undo', b: { c: 'Redo', d_one: '{{count}} tab' } })
    expect(out).toEqual({ a: '[Ûñðö]', b: { c: '[Ŕéðö]', d_one: expect.stringMatching(/^\[\{\{count\}\} ţàƀ·*\]$/) } })
  })

  it('passes non-string values through', () => {
    expect(pseudoLocalizeCatalog(3)).toBe(3)
    expect(pseudoLocalizeCatalog(null)).toBe(null)
  })

  it('uses Chromium\'s long-text pseudo-locale tag', () => {
    expect(PSEUDO_LOCALE).toBe('en-XA')
  })
})
