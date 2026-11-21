/**
 * The generator reads a post's strings exactly as JavaScript would: direction marks (U+200E,
 * U+200F, U+061C) written as characters or as `\u` escapes, and escaped quotes, round-trip into the
 * generated index unchanged, so it matches the parsed `post`.
 */
import { describe, expect, it } from 'vitest'
import { readPostSummary, renderBlogIndexModule, unescapeJsString } from '@/scripts/generate-blog-index.mjs'

/** The post block evaluated as JavaScript: what the MDX module exports. */
function evaluatePost(source: string): { title: string; description: string } {
  const literal = source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1)
  return new Function(`return (${literal})`)() as { title: string; description: string }
}

const RLM = '‏'
const LRM = '‎'
const ALM = '؜'

describe('direction marks and escapes', () => {
  const source = [
    'export const post = {',
    `  title: 'Chrome،${RLM} Edge ${LRM}and\\u200F Firefox',`,
    `  description: 'نکتهٔ ${ALM}مهم: it\\'s \\u{1F600} \\x41\\\\ done',`,
    '}',
    '',
  ].join('\n')

  it('reads the same strings JavaScript evaluates', () => {
    const summary = readPostSummary(source)
    const post = evaluatePost(source)
    expect(summary.title).toBe(post.title)
    expect(summary.description).toBe(post.description)
    expect(summary.title).toContain(RLM)
    expect(summary.title).toContain(LRM)
    expect(summary.description).toContain(ALM)
    expect(summary.description).toContain("it's")
  })

  it('keeps the marks through the generated module', () => {
    const summary = readPostSummary(source)
    const generated = renderBlogIndexModule({ demo: { en: { file: 'en.mdx', words: 1, ...summary } } })
    const title = /title: ("(?:[^"\\]|\\.)*")/.exec(generated)![1]
    expect(JSON.parse(title)).toBe(summary.title)
  })

  it('resolves each escape form', () => {
    expect(unescapeJsString('\\u200F')).toBe(RLM)
    expect(unescapeJsString('\\u{61C}')).toBe(ALM)
    expect(unescapeJsString('\\x41\\n\\\\')).toBe('A\n\\')
    expect(unescapeJsString("\\'")).toBe("'")
  })
})
