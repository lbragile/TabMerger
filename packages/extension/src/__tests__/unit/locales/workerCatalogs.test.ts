import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '@tabmerger/shared'
import { buildI18nOptions } from '@/lib/i18n'
import { catalogs } from '@/locales'
import { en } from '@/locales/en'
import { flattenCatalog } from '@/locales/validate'
import { WORKER_AREAS, workerCatalogs } from '@/locales/worker'

const SRC = path.resolve(__dirname, '../../..')
const ENTRY = path.join(SRC, 'entrypoints/background.ts')

/** The source file a relative or `@/` specifier points at, or undefined for a package or asset. */
function resolveSource(from: string, specifier: string): string | undefined {
  let base: string
  if (specifier.startsWith('@/')) base = path.join(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier)
  else return undefined
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  return candidates.find((file) => /\.tsx?$/.test(file) && existsSync(file))
}

/**
 * Every source file the background worker's bundle can contain: its import graph from
 * background.ts, following value imports (static, re-exports and `import()`), not `import type`.
 */
function workerSourceFiles(): string[] {
  const seen = new Set<string>()
  const queue = [ENTRY]
  const importRE = /(?:^|[\s;])(import|export)(\s+type\b)?[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const code = readFileSync(file, 'utf8')
    for (const match of code.matchAll(importRE)) {
      if (match[2]) continue // type-only import: erased from the bundle
      const specifier = match[3] ?? match[4] ?? match[5]
      const target = specifier && resolveSource(file, specifier)
      if (target && !seen.has(target)) queue.push(target)
    }
  }
  return [...seen]
}

const englishKeys = Object.keys(flattenCatalog(en))

/** The catalog key (or key prefix, for a template literal) a string literal refers to, if any. */
function catalogKeyOf(literal: string, isPrefix: boolean): string | undefined {
  if (isPrefix) return englishKeys.find((key) => key.startsWith(literal))
  return englishKeys.find((key) => key === literal || key.startsWith(`${literal}_`))
}

describe('background worker catalogs', () => {
  const areaPattern = Object.keys(en).join('|')
  const literalRE = new RegExp(`['"\`]((?:${areaPattern})\\.[A-Za-z0-9_.]*)(['"\`]|\\$\\{)`, 'g')

  const usedKeys = new Map<string, string>() // key -> file
  for (const file of workerSourceFiles()) {
    // The catalogs themselves hold no lookups; comments may quote a key as an example
    if (file.startsWith(path.join(SRC, 'locales'))) continue
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const match of code.matchAll(literalRE)) {
      const literal = match[1]
      const key = catalogKeyOf(literal, match[2] === '${' || literal.endsWith('.'))
      if (key) usedKeys.set(literal, path.relative(SRC, file))
    }
  }
  const usedAreas = new Set([...usedKeys.keys()].map((key) => key.split('.')[0]))

  it('finds the catalog keys the worker reads (the import walk reaches its modules)', () => {
    expect(usedKeys.has('background.menu.saveTo')).toBe(true)
    expect(usedKeys.has('common.quickSaveGroup')).toBe(true)
  })

  it('bundles every catalog area that code in the worker reads', () => {
    const missing = [...usedKeys].filter(([key]) => !(WORKER_AREAS as readonly string[]).includes(key.split('.')[0]))
    // A key listed here would show in English in the worker: add its area to locales/worker.ts
    expect(missing).toEqual([])
  })

  it('bundles no area the worker does not read', () => {
    expect([...WORKER_AREAS].filter((area) => !usedAreas.has(area))).toEqual([])
  })

  it('has every supported language, English in full and the rest limited to the worker areas', () => {
    expect(Object.keys(workerCatalogs).sort()).toEqual([...SUPPORTED_LOCALES].sort())
    expect(workerCatalogs.en).toBe(en)
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue
      expect(Object.keys(workerCatalogs[locale]).sort()).toEqual([...WORKER_AREAS].sort())
      for (const area of WORKER_AREAS) expect(workerCatalogs[locale][area], `${locale}/${area}`).toEqual(catalogs[locale][area])
    }
  })

  it('translates worker messages and falls back to English outside the worker areas', () => {
    const instance = i18next.createInstance()
    void instance.init(buildI18nOptions(workerCatalogs, 'ru'))
    expect(instance.t('background.menu.noGroups')).toBe((catalogs.ru.background as { menu: { noGroups: string } }).menu.noGroups)
    expect(instance.t('background.menu.noGroups')).not.toBe(en.background.menu.noGroups)
    expect(instance.t('header.undo')).toBe(en.header.undo)
  })
})
