/**
 * Message catalogs: every locale's catalog has exactly the English keys, and each message keeps
 * the English placeholders (`{count}`) and rich-text tags (`<link>`). Only English ships today, so
 * this passes trivially for real locales; the generated pseudo-locale goes through the same checks
 * (it must never break a message). A new language is a folder in messages/ (one JSON file per
 * namespace, like messages/en/) plus its locale in `SUPPORTED_LOCALES`; this test picks the folder
 * up and holds it to the English shape.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import en from '@/messages/en'
import { pseudoLocalize, type MessageTree } from '@/i18n/pseudo'
import { SUPPORTED_LOCALES } from '@tabmerger/shared'

const MESSAGES_DIR = join(__dirname, '..', 'messages')

/** `{ 'a.b': 'text' }` for every leaf message. */
function flatten(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

/** The message with ICU-quoted text ('{', '<group>', '') removed, so only real syntax is left. */
function withoutQuoted(message: string): string {
  return message.replace(/''/g, '').replace(/'[{}<>#|][^']*'/g, '')
}

/**
 * Argument names (`{count}`, `{count, plural, one {…} other {…}}`), sorted and unique. A small
 * ICU walk: text-level braces open arguments; inside a plural/select argument, `selector {…}`
 * pairs hold nested messages, walked the same way.
 */
function placeholders(message: string): string[] {
  const text = withoutQuoted(message)
  const names = new Set<string>()
  // Walks message text from `i` until an unmatched `}`; returns the index of that brace.
  const walkText = (i: number): number => {
    while (i < text.length && text[i] !== '}') i = text[i] === '{' ? walkArgument(i + 1) : i + 1
    return i
  }
  // Walks an argument whose `{` is just before `i`; returns the index after its closing `}`.
  const walkArgument = (i: number): number => {
    const header = /^\s*([A-Za-z0-9_]+)\s*(?:,\s*([a-z]+)\s*,?)?/.exec(text.slice(i))!
    names.add(header[1])
    i += header[0].length
    const branching = header[2] === 'plural' || header[2] === 'select' || header[2] === 'selectordinal'
    while (i < text.length && text[i] !== '}') {
      i = branching && text[i] === '{' ? walkText(i + 1) + 1 : i + 1
    }
    return i + 1
  }
  walkText(0)
  return [...names].sort()
}

/** Rich-text tag names (`<link>…</link>`, `<full></full>`), sorted and unique. */
function tags(message: string): string[] {
  const names = [...withoutQuoted(message).matchAll(/<\/?([A-Za-z0-9_]+)\s*\/?>/g)].map((m) => m[1])
  return [...new Set(names)].sort()
}

const english = flatten(en)

const localeDirs = readdirSync(MESSAGES_DIR).filter((name) => statSync(join(MESSAGES_DIR, name)).isDirectory())

/** A locale folder read straight from disk: `{ <namespace>: <file contents> }`. */
function readCatalog(locale: string): MessageTree {
  const dir = join(MESSAGES_DIR, locale)
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [file.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, file), 'utf8'))])
  )
}

const catalogs: [locale: string, messages: Record<string, string>][] = [
  ...localeDirs
    .filter((locale) => locale !== 'en')
    .map((locale): [string, Record<string, string>] => [locale, flatten(readCatalog(locale))]),
  ['en-XA (pseudo)', flatten(pseudoLocalize(en))],
]

describe('message catalogs', () => {
  it('has a catalog folder for every shipped locale', () => {
    for (const locale of SUPPORTED_LOCALES) expect(localeDirs).toContain(locale)
  })

  it('loads every English namespace file (messages/en/index.ts lists them all)', () => {
    expect(en).toEqual(readCatalog('en'))
  })

  it('formats every English message (valid ICU syntax), with placeholders and tags filled', () => {
    const t = createTranslator({ locale: 'en', messages: en })
    for (const [key, message] of Object.entries(english)) {
      const values: Record<string, unknown> = {}
      for (const name of placeholders(message)) values[name] = 2
      for (const tag of tags(message)) values[tag] = (chunks: string) => chunks
      expect(() => t.markup(key as never, values as never), key).not.toThrow()
    }
  })

  it.each(catalogs)('%s has exactly the English keys', (_locale, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(english).sort())
  })

  it.each(catalogs)('%s keeps every placeholder and tag of the English message', (_locale, messages) => {
    for (const [key, message] of Object.entries(messages)) {
      expect(placeholders(message), `${key} placeholders`).toEqual(placeholders(english[key]))
      expect(tags(message), `${key} tags`).toEqual(tags(english[key]))
    }
  })
})

describe('language picker keys', () => {
  const KEYS = ['searchPlaceholder', 'searchLabel', 'noResults', 'rightToLeft']
  const shipped = SUPPORTED_LOCALES.filter((locale) => locale !== 'en')

  it.each(['en', ...shipped])('%s has the four language-picker keys, non-empty', (locale) => {
    const picker = (readCatalog(locale) as Record<string, Record<string, string>>).languageSwitcher
    for (const key of KEYS) {
      expect(typeof picker[key], `${locale} ${key}`).toBe('string')
      expect(picker[key].trim().length, `${locale} ${key}`).toBeGreaterThan(0)
    }
  })

  it.each(['ar', 'he', 'fa'])('%s isolates each Latin run of the search example on its own', (locale) => {
    const text = (readCatalog(locale) as Record<string, Record<string, string>>).languageSwitcher.searchPlaceholder
    // One first-strong isolate (U+2068 ... U+2069) per Latin run (the code "de"), and no Latin
    // letter outside one, so the run keeps its place beside the RTL comma and parenthesis.
    const isolates = [...text.matchAll(/\u2068([^\u2068\u2069]*)\u2069/g)].map((m) => m[1])
    expect(isolates).toEqual(['de'])
    expect(text.replace(/\u2068[^\u2068\u2069]*\u2069/g, '')).not.toMatch(/[A-Za-z]/)
  })

  it.each(['en', ...shipped])('%s search example names a language and gives its code', (locale) => {
    const text = (readCatalog(locale) as Record<string, Record<string, string>>).languageSwitcher.searchPlaceholder
    // "<name in the UI language>, <code>": German, except in German, where it is French. Two
    // parts, not three (with the native name): three did not fit a 320px screen in nine locales.
    if (locale === 'de') expect(text).toMatch(/Französisch, fr\)/)
    else expect(text.replace(/[\u2068\u2069]/g, '')).toMatch(/[,،、] ?de[)）]/)
  })
})

describe('right-to-left catalogs: Latin lists', () => {
  // In Arabic, Hebrew or Persian prose a comma between two bare Latin words resolves left to
  // right (it sits between two left-to-right runs), so "Chrome, Edge" became one run and showed
  // Edge first. Each Latin item of such a list goes in its own first-strong isolate
  // (U+2068 ... U+2069), which leaves the comma to the sentence. ICU syntax ("count, plural") is
  // not prose and is skipped, as are placeholders and tags.
  const LATIN = String.raw`[A-Za-z][A-Za-z0-9.+#'’-]*(?: [A-Za-z0-9][A-Za-z0-9.+#'’-]*)*`
  const JOINED = new RegExp(String.raw`${LATIN}["”)\]]*\s*[,،]\s*["“(\[]*${LATIN}`)

  /** The prose of a message: isolated runs, ICU headers, placeholders and tags blanked out. */
  const prose = (message: string) =>
    message
      .replace(/⁨[^⁨⁩]*⁩/g, '\u0000')
      .replace(/\{\s*\w+\s*,\s*(?:plural|select|selectordinal|number|date|time)\s*,?/g, '\u0000')
      .replace(/\{\s*\w+\s*\}/g, '\u0000')
      .replace(/<\/?\w+>/g, '\u0000')
      .replace(/[{}]/g, '\u0000')

  it('recognises a joined list and lets an isolated one through', () => {
    expect(JOINED.test(prose('תומך ב-Chrome, Edge ו-Brave'))).toBe(true)
    expect(JOINED.test(prose('"Free", "Pro"'))).toBe(true)
    expect(JOINED.test(prose('Mac، Cmd+K'))).toBe(true)
    expect(JOINED.test(prose('תומך ב-⁨Chrome⁩, ⁨Edge⁩'))).toBe(false)
    expect(JOINED.test(prose('{count, plural, one {# דירוג} other {# דירוגים}}'))).toBe(false)
  })

  it.each(['ar', 'he', 'fa'])('%s isolates each Latin item of a list in its prose', (locale) => {
    const joined = Object.entries(flatten(readCatalog(locale)))
      .filter(([, message]) => JOINED.test(prose(message)))
      .map(([key, message]) => `${key}: ${prose(message).match(JOINED)![0]}`)
    expect(joined).toEqual([])
  })
})

describe('he: one-letter prefixes', () => {
  // Hebrew joins a one-letter prefix (ו ב ל מ ה כ ש) to a Latin word or a number with a hyphen:
  // "ו-Edge", "ב-Chrome", "ל-2". A simple placeholder ({store}, {last}) is filled with one of
  // those, so it gets the hyphen too. A plural or select block is left out: its branches decide
  // ("בחלון אחד" for one, "ב-{windows} חלונות" for other).
  const GLUED = /(?<![א-ת׳'])[ובלמהכש](?:[A-Za-z0-9⁨]|\{\s*\w+\s*\})/

  it('recognises a glued prefix and lets a hyphenated one or a plural block through', () => {
    expect(GLUED.test('ב-Chrome וEdge')).toBe(true)
    expect(GLUED.test('ל2 חלונות')).toBe(true)
    expect(GLUED.test('{first} ו{second}')).toBe(true)
    expect(GLUED.test('ו⁨Edge⁩')).toBe(true)
    expect(GLUED.test('ב-⁨Chrome⁩ ו-⁨Edge⁩')).toBe(false)
    expect(GLUED.test('ב{windows, plural, one {חלון אחד} other {-{windows} חלונות}}')).toBe(false)
    expect(GLUED.test('חלון Chrome')).toBe(false)
  })

  it('has no prefix glued to a Latin word, a number, an isolate or a placeholder', () => {
    const glued = Object.entries(flatten(readCatalog('he')))
      .filter(([, message]) => GLUED.test(message))
      .map(([key, message]) => `${key}: ${message.match(GLUED)![0]}`)
    expect(glued).toEqual([])
  })
})

/** Top-level plural blocks in a message: the selectors of each `{name, plural, sel {…} …}`. */
function pluralSelectors(message: string): string[][] {
  const text = withoutQuoted(message)
  const found: string[][] = []
  const scan = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (text[i] !== '{') continue
      // Match this argument's closing brace.
      let depth = 0
      let end = i
      for (; end < to; end++) {
        if (text[end] === '{') depth++
        else if (text[end] === '}' && --depth === 0) break
      }
      const body = text.slice(i + 1, end)
      const head = /^\s*[A-Za-z0-9_]+\s*,\s*plural\s*,/.exec(body)
      if (head) {
        const selectors: string[] = []
        let d = 0
        let word = ''
        for (let j = head[0].length; j < body.length; j++) {
          const ch = body[j]
          if (ch === '{') {
            if (d === 0) selectors.push(word.trim())
            d++
            word = ''
          } else if (ch === '}') d--
          else if (d === 0) word += ch
        }
        found.push(selectors)
      }
      scan(i + 1, end)
      i = end
    }
  }
  scan(0, text.length)
  return found
}

describe('ICU plural forms', () => {
  const pluralKeys = Object.entries(english).filter(([, message]) => pluralSelectors(message).length > 0)

  it('finds the English plural messages (the check below is not vacuous)', () => {
    expect(pluralKeys.length).toBeGreaterThan(0)
  })

  const catalogFor = (locale: string) => flatten(readCatalog(locale))

  it('ar spells out every category Intl.PluralRules uses wherever it has an other form', () => {
    const needed = new Intl.PluralRules('ar').resolvedOptions().pluralCategories
    const ar = catalogFor('ar')
    const missing: string[] = []
    for (const [key] of pluralKeys) {
      for (const selectors of pluralSelectors(ar[key])) {
        if (!selectors.includes('other')) continue
        const absent = needed.filter((category) => !selectors.includes(category))
        if (absent.length) missing.push(`${key}: missing ${absent.join('/')}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('he has one and two wherever English has one', () => {
    const he = catalogFor('he')
    const missing: string[] = []
    for (const [key, message] of pluralKeys) {
      const englishHasOne = pluralSelectors(message).some((selectors) => selectors.includes('one'))
      if (!englishHasOne) continue
      for (const selectors of pluralSelectors(he[key])) {
        for (const category of ['one', 'two']) {
          if (!selectors.includes(category)) missing.push(`${key}: missing ${category}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
