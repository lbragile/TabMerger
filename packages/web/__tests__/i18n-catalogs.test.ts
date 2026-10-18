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
