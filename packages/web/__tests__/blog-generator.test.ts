/**
 * scripts/generate-blog-index.mjs: the readable-word count behind the read time, the post summary
 * read from the source text, the recorded annotation boxes, and the generated module's source.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  countReadableWords,
  generateBlogIndexModule,
  readBoxes,
  readPostSummary,
  renderBlogIndexModule,
  scanBlogContent,
} from '@/scripts/generate-blog-index.mjs'

const POST = (published = '2026-11-19') => `export const post = {
  slug: 'demo',
  title: 'A demo \\'quoted\\' title',
  description: 'About the demo.',
  shareSummary: 'Short.',
  published: '${published}',
  images: [
    { src: '/blog/demo/one.webp', alt: 'One' },
    { src: '/blog/demo/two.webp', alt: 'Two' },
  ],
  tags: ['chrome', 'save-tabs', 'bookmarks'],
}

Hello **big** world.
`

describe('countReadableWords', () => {
  it('counts the prose and ignores the post export, comments, JSX tags and punctuation-only tokens', () => {
    const source = `export const post = {
  title: 'ignored words here',
}

{/* a comment that is not read */}

<Section id="a" title="not counted either">
One two three — four.
<Kbd>Ctrl</Kbd> + <Kbd>D</Kbd>
</Section>
`
    // One two three four Ctrl D: the dash and the plus are not words.
    expect(countReadableWords(source)).toBe(6)
  })

  it('leaves out the panels of the browsers a reader does not see by default', () => {
    const source = `<BrowserPanel browser="chrome">
alpha beta
</BrowserPanel>
<BrowserPanel browser="edge">
gamma delta epsilon
</BrowserPanel>
<BrowserPanel browser="firefox" extra="x">
zeta
</BrowserPanel>`
    expect(countReadableWords(source)).toBe(2)
  })

  it('counts words in any script', () => {
    expect(countReadableWords('Сохраните все вкладки 保存 123')).toBe(5)
    expect(countReadableWords('')).toBe(0)
  })
})

describe('readPostSummary', () => {
  it('reads the fields sync code needs from the post block', () => {
    expect(readPostSummary(POST())).toEqual({
      title: "A demo 'quoted' title",
      description: 'About the demo.',
      shareSummary: 'Short.',
      published: '2026-11-19',
      images: ['/blog/demo/one.webp', '/blog/demo/two.webp'],
      tags: ['chrome', 'save-tabs', 'bookmarks'],
    })
  })

  it('answers empty values for a file without a post block', () => {
    expect(readPostSummary('Just text.')).toEqual({
      title: '',
      description: '',
      shareSummary: '',
      published: '',
      images: [],
      tags: [],
    })
  })
})

describe('on a content folder', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'blog-gen-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const post = (slug: string, files: Record<string, string>) => {
    mkdirSync(join(dir, slug), { recursive: true })
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, slug, name), content)
  }

  describe('readBoxes', () => {
    it('answers {} when the post has no boxes.json', () => {
      post('demo', { 'en.mdx': POST() })
      expect(readBoxes(dir, 'demo')).toEqual({})
    })

    it('reads numbers and percent strings as numbers, dropping the capture script label', () => {
      post('demo', {
        'boxes.json': JSON.stringify({
          shot: [
            { id: 'a', label: 'ignored', l: '4.84%', t: 10, w: ' 20 ', h: '5.5' },
            { id: 'b', l: 0, t: '0%', w: 1, h: 1 },
          ],
        }),
      })
      expect(readBoxes(dir, 'demo')).toEqual({
        shot: [
          { id: 'a', l: 4.84, t: 10, w: 20, h: 5.5 },
          { id: 'b', l: 0, t: 0, w: 1, h: 1 },
        ],
      })
    })

    it('throws for an image whose boxes are not a list', () => {
      post('demo', { 'boxes.json': JSON.stringify({ shot: { id: 'a' } }) })
      expect(() => readBoxes(dir, 'demo')).toThrow(/is not a list/)
    })

    it.each([
      ['no id', { l: 1, t: 1, w: 1, h: 1 }],
      ['a non-numeric value', { id: 'a', l: 'wide', t: 1, w: 1, h: 1 }],
      ['a missing value', { id: 'a', l: 1, t: 1, w: 1 }],
      ['a numeric id', { id: 3, l: 1, t: 1, w: 1, h: 1 }],
    ])('throws for a box with %s', (_, box) => {
      post('demo', { 'boxes.json': JSON.stringify({ shot: [box] }) })
      expect(() => readBoxes(dir, 'demo')).toThrow(/box without an id or a number/)
    })
  })

  describe('scanBlogContent and renderBlogIndexModule', () => {
    it('lists each post folder and locale file, ignoring other files and files that are not posts', () => {
      post('demo', { 'en.mdx': POST(), 'pt-BR.mdx': POST(), 'notes.txt': 'x', 'README.md': 'x', 'english.mdx': 'x' })
      writeFileSync(join(dir, 'stray.mdx'), 'x')
      const posts = scanBlogContent(dir)
      expect(Object.keys(posts)).toEqual(['demo'])
      expect(Object.keys(posts.demo).sort()).toEqual(['en', 'pt-BR'])
      expect(posts.demo.en.words).toBe(3)
    })

    it('answers nothing for a missing folder', () => {
      expect(scanBlogContent(join(dir, 'nope'))).toEqual({})
    })

    it('rejects a folder that is not a valid slug and a post without English', () => {
      post('Bad_Slug', { 'en.mdx': POST() })
      expect(() => scanBlogContent(dir)).toThrow(/not a valid post slug/)
      rmSync(join(dir, 'Bad_Slug'), { recursive: true })
      post('demo', { 'es.mdx': POST() })
      expect(() => scanBlogContent(dir)).toThrow(/no en\.mdx/)
    })

    it('renders a module with one static import per file, the summaries and the boxes', () => {
      post('demo', {
        'en.mdx': POST('2026-11-19'),
        'es.mdx': POST('2026-11-19'),
        'boxes.json': JSON.stringify({ one: [{ id: 'x', l: '1%', t: '2%', w: '3%', h: '4%' }] }),
      })
      const source = renderBlogIndexModule(scanBlogContent(dir))
      expect(source).toContain('export const BLOG_SOURCES')
      expect(source).toContain('"demo": {')
      expect(source).toContain('load: () => import("@/content/blog/demo/en.mdx")')
      expect(source).toContain('load: () => import("@/content/blog/demo/es.mdx")')
      expect(source).toContain('published: "2026-11-19"')
      expect(source).toContain('tags: ["chrome","save-tabs","bookmarks"]')
      expect(source).toContain(
        'export const BLOG_BOXES: Record<string, Record<string, readonly { id: string; l: number; t: number; w: number; h: number }[]>> = {"demo":{"one":[{"id":"x","l":1,"t":2,"w":3,"h":4}]}}'
      )
    })

    it('renders an empty module for no posts', () => {
      const source = renderBlogIndexModule({})
      expect(source).toContain('BLOG_SOURCES: Record<string, Record<string, BlogSource>> = {\n}')
      expect(source).toContain('= {}')
    })
  })

  it('writes the module once and leaves an unchanged one alone', () => {
    post('demo', { 'en.mdx': POST() })
    const outDir = mkdtempSync(join(tmpdir(), 'blog-out-'))
    const out = join(outDir, 'generated', 'blog.ts')
    expect(generateBlogIndexModule({ dir, out })).toBe(true)
    expect(readFileSync(out, 'utf8')).toContain('"demo"')
    expect(generateBlogIndexModule({ dir, out })).toBe(false)
    post('other', { 'en.mdx': POST('2026-12-01') })
    expect(generateBlogIndexModule({ dir, out })).toBe(true)
    expect(readFileSync(out, 'utf8')).toContain('"other"')
    rmSync(outDir, { recursive: true, force: true })
  })
})
