import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '@tabmerger/shared'
import { catalogs } from '@/locales'
import { en } from '@/locales/en'
import { flattenCatalog, validateCatalog, validateReferencePlurals } from '@/locales/validate'

describe('message catalogs', () => {
  it('ships a catalog for every supported locale, and only those', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('registers every English feature file in the catalog index', () => {
    const dir = path.resolve(__dirname, '../../../locales/en')
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    expect(Object.keys(en).sort()).toEqual(files.sort())
  })

  it('English plural families have exactly the English forms (one and other)', () => {
    expect(validateReferencePlurals(en)).toEqual([])
  })

  it('has no empty English message', () => {
    const empty = Object.entries(flattenCatalog(en)).filter(([, text]) => text.trim() === '')
    expect(empty).toEqual([])
  })

  it.each(Object.entries(catalogs))('the %s catalog matches English: keys, placeholders, tags and plural forms', (locale, catalog) => {
    expect(validateCatalog(locale, catalog, en)).toEqual([])
  })
})

describe('validateCatalog', () => {
  const reference = {
    area: {
      plain: 'Hello {{name}}',
      rich: 'Read <strong>{{what}}</strong>',
      tabCount_one: '{{count}} tab',
      tabCount_other: '{{count}} tabs'
    }
  }

  it('accepts a complete translation', () => {
    const de = { area: { plain: 'Hallo {{name}}', rich: 'Lies <strong>{{what}}</strong>', tabCount_one: '{{count}} Tab', tabCount_other: '{{count}} Tabs' } }
    expect(validateCatalog('de', de, reference)).toEqual([])
  })

  it('reports missing and extra keys', () => {
    const de = { area: { rich: 'Lies <strong>{{what}}</strong>', tabCount_one: '1', tabCount_other: '{{count}}', bonus: 'x' } }
    const problems = validateCatalog('de', de, reference).map((i) => `${i.problem}:${i.key}`)
    expect(problems).toEqual(expect.arrayContaining(['missing:area.plain', 'extra:area.bonus']))
  })

  it('reports a changed placeholder and a dropped tag', () => {
    const de = { area: { plain: 'Hallo {{nom}}', rich: 'Lies {{what}}', tabCount_one: '{{count}} Tab', tabCount_other: '{{count}} Tabs' } }
    const problems = validateCatalog('de', de, reference).map((i) => `${i.problem}:${i.key}`)
    expect(problems).toEqual(['placeholders:area.plain', 'tags:area.rich'])
  })

  it('needs every plural form of the language, and no others', () => {
    // Polish has one / few / many / other
    const pl = { area: { plain: 'Cześć {{name}}', rich: 'Czytaj <strong>{{what}}</strong>', tabCount_one: '{{count}} karta', tabCount_other: '{{count}} kart' } }
    const plural = validateCatalog('pl', pl, reference).filter((i) => i.problem === 'plural')
    expect(plural).toHaveLength(1)
    expect(plural[0].detail).toContain('few')
    const plOk = { area: { ...pl.area, tabCount_few: '{{count}} karty', tabCount_many: '{{count}} kart' } }
    expect(validateCatalog('pl', plOk, reference)).toEqual([])
  })

  it('reports an empty message', () => {
    const de = { area: { plain: ' ', rich: 'Lies <strong>{{what}}</strong>', tabCount_one: '{{count}} Tab', tabCount_other: '{{count}} Tabs' } }
    expect(validateCatalog('de', de, reference).map((i) => i.problem)).toContain('empty')
  })
})
