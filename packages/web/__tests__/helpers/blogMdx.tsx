/**
 * Loads a blog post's real MDX file in Vitest (which has no MDX plugin): compiles it with the same
 * remark/rehype plugins as next.config.ts and evaluates it with the blog's components. Lets tests
 * check every post and locale file that exists, without naming any of them.
 */
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as runtime from 'react/jsx-runtime'
import type { MDXContent } from 'mdx/types'

export const BLOG_CONTENT = join(__dirname, '..', '..', 'content', 'blog')

/** Every `{ slug, locale, file }` under content/blog, whatever locales exist. */
export function blogFiles(): { slug: string; locale: string; file: string }[] {
  return readdirSync(BLOG_CONTENT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_')) // `_placeholders` holds dev-only English drafts
    .flatMap((d) =>
      readdirSync(join(BLOG_CONTENT, d.name))
        .filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.mdx$/.test(f))
        .map((f) => ({ slug: d.name, locale: f.replace('.mdx', ''), file: join(BLOG_CONTENT, d.name, f) }))
    )
}

export function blogSource(slug: string, locale = 'en'): string {
  return readFileSync(join(BLOG_CONTENT, slug, `${locale}.mdx`), 'utf8')
}

export function hasBlogFile(slug: string, locale: string): boolean {
  return existsSync(join(BLOG_CONTENT, slug, `${locale}.mdx`))
}

async function mdxCompiler(): Promise<{ evaluate: (src: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>> }> {
  // @mdx-js/mdx is a dependency of @next/mdx / @mdx-js/loader, not of this package: resolve it from there.
  const req = createRequire(import.meta.url)
  const fromLoader = createRequire(req.resolve('@mdx-js/loader'))
  return import(/* @vite-ignore */ pathToFileURL(fromLoader.resolve('@mdx-js/mdx')).href)
}

export interface EvaluatedPost {
  post: unknown
  Content: MDXContent
}

/** Compile + evaluate MDX source with the blog's plugins; `components` default to mdx-components.tsx. */
export async function evaluateMdx(source: string, components?: Record<string, unknown>): Promise<EvaluatedPost> {
  const { evaluate } = await mdxCompiler()
  const [{ default: remarkGfm }, { default: alerts }, { default: unwrap }, { default: slug }, { default: autolink }, { default: external }] =
    await Promise.all([
      import('remark-gfm'),
      import('remark-github-blockquote-alert'),
      import('rehype-unwrap-images'),
      import('rehype-slug'),
      import('rehype-autolink-headings'),
      import('rehype-external-links'),
    ])
  const figureNumbers = (await import('@/lib/blog/mdx/rehype-figure-numbers.mjs')).default
  const mod = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkGfm, alerts],
    rehypePlugins: [
      unwrap,
      slug,
      [autolink, { behavior: 'append', properties: { className: ['heading-anchor'], ariaHidden: 'true', tabIndex: -1 }, content: { type: 'text', value: '#' } }],
      [external, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
      figureNumbers,
    ],
    useMDXComponents: components ? () => components : (await import('@/mdx-components')).useMDXComponents,
  })
  return { post: mod.post, Content: mod.default as MDXContent }
}

export function loadBlogFile(slug: string, locale = 'en', components?: Record<string, unknown>) {
  return evaluateMdx(blogSource(slug, locale), components)
}
