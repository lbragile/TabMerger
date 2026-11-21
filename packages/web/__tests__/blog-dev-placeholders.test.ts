/**
 * Dev-only placeholder posts (content/blog/_placeholders). The generator lists them, flagged, in
 * every mode but a production build (so `next dev`, Vitest and type-check write the same file),
 * and leaves them out of a production build entirely. At runtime they count only under `next dev`
 * without BLOG_DEV_PLACEHOLDERS=0, and they are never indexable.
 */
import { describe, expect, it } from 'vitest'
import { BLOG_SOURCES as GENERATED } from '@/generated/blog'
import { BLOG_CONTENT_DIR, includePlaceholders, renderBlogIndexModule, scanBlogContent } from '@/scripts/generate-blog-index.mjs'
import { BLOG_SLUGS, BLOG_SOURCES, indexableSlugs, isPlaceholder, placeholdersEnabled, withoutPlaceholders } from '@/lib/blog/posts'

const placeholderSlugs = (posts: unknown) =>
  Object.entries(posts as Record<string, Record<string, { placeholder?: boolean }>>)
    .filter(([, locales]) => locales.en?.placeholder)
    .map(([slug]) => slug)

describe('the generator', () => {
  it.each([{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}])('lists the placeholders, flagged, for %o', (env) => {
    const posts = scanBlogContent(BLOG_CONTENT_DIR, { placeholders: includePlaceholders(env as NodeJS.ProcessEnv) })
    const slugs = placeholderSlugs(posts)
    expect(slugs.length).toBeGreaterThanOrEqual(2)
    const source = renderBlogIndexModule(posts)
    for (const slug of slugs) expect(source).toContain(`@/content/blog/_placeholders/${slug}/en.mdx`)
    expect(source).toContain('placeholder: true')
  })

  it('leaves them out of a production build: no entry, no import', () => {
    const posts = scanBlogContent(BLOG_CONTENT_DIR, { placeholders: includePlaceholders({ NODE_ENV: 'production' } as NodeJS.ProcessEnv) })
    expect(placeholderSlugs(posts)).toEqual([])
    const source = renderBlogIndexModule(posts)
    expect(source).not.toContain('@/content/blog/_placeholders')
    expect(source).not.toContain('placeholder: true')
    expect(source).not.toMatch(/dev-placeholder-/)
  })
})

describe('at runtime', () => {
  it.each([
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'development', BLOG_DEV_PLACEHOLDERS: '0' }, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{}, false],
  ])('placeholdersEnabled(%o) → %s', (env, expected) => {
    expect(placeholdersEnabled(env)).toBe(expected)
  })

  it('the generated file has them, the test run filters them out', () => {
    expect(placeholderSlugs(GENERATED).length).toBeGreaterThanOrEqual(2)
    expect(placeholderSlugs(BLOG_SOURCES)).toEqual([])
    expect(BLOG_SLUGS.some((slug) => slug.startsWith('dev-placeholder-'))).toBe(false)
    expect(Object.keys(withoutPlaceholders(GENERATED))).toEqual(Object.keys(BLOG_SOURCES))
  })

  it('never counts a placeholder as indexable', () => {
    const fake = { p: { en: { title: 'x', published: '2026-01-01', placeholder: true } } } as never
    expect(isPlaceholder('p', fake)).toBe(true)
    expect(indexableSlugs().every((slug) => !isPlaceholder(slug))).toBe(true)
  })
})
