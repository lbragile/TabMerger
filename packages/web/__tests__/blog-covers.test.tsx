/**
 * Blog index covers: shown whole in a 4:3 frame, never cropped. The generator's checks (file
 * exists, within 2% of 4:3, no focus/zoom fields), the fallback order (cover, first 4:3 capture,
 * the TabMerger mark; never a wide strip), translations inheriting the English cover, the theme
 * pair, and the hover scale only without reduced motion.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { CoverImage } from '@/components/blog/CoverImage'
import { BLOG_SOURCES as GENERATED } from '@/generated/blog'
import { isCoverRatio } from '@/lib/blog/cover'
import { cardCover, type Post } from '@/lib/blog/posts'
import {
  COVER_RATIO_TOLERANCE,
  PUBLIC_DIR,
  imageSize,
  isCoverRatio as generatorIsCoverRatio,
  readCover,
  resolveCover,
  scanBlogContent,
} from '@/scripts/generate-blog-index.mjs'

/** A PNG header with the given size (all `imageSize` reads). */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33)
  b.writeUInt32BE(0x89504e47, 0)
  b.writeUInt32BE(0x0d0a1a0a, 4)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

let publicDir: string
const image = (name: string, width: number, height: number) => {
  mkdirSync(join(publicDir, 'blog', 'demo'), { recursive: true })
  writeFileSync(join(publicDir, 'blog', 'demo', name), png(width, height))
  return `/blog/demo/${name}`
}

beforeEach(() => {
  publicDir = mkdtempSync(join(tmpdir(), 'blog-covers-'))
})
afterEach(() => {
  rmSync(publicDir, { recursive: true, force: true })
})

describe('cover ratio', () => {
  it('accepts 4:3 within 2% and rejects wide browser strips', () => {
    expect(COVER_RATIO_TOLERANCE).toBe(0.02)
    for (const check of [isCoverRatio, generatorIsCoverRatio]) {
      expect(check(1600, 1200)).toBe(true)
      expect(check(1630, 1200)).toBe(true) // +1.9%
      expect(check(1570, 1200)).toBe(true) // −1.9%
      expect(check(1640, 1200)).toBe(false) // +2.5%
      expect(check(1600, 524)).toBe(false) // a 3:1 bookmarks strip
      expect(check(1600, 900)).toBe(false) // 16:9
      expect(check(0, 0)).toBe(false)
    }
  })

  it('reads the size from the real WebP captures', () => {
    expect(imageSize(join(PUBLIC_DIR, 'blog', 'save-all-open-tabs', 'tm-save-session-dialog-light.webp'))).toEqual({ width: 1600, height: 1200 })
    const strip = imageSize(join(PUBLIC_DIR, 'blog', 'save-all-open-tabs', 'chrome-bookmarks-folder.webp'))!
    expect(isCoverRatio(strip.width, strip.height)).toBe(false)
  })
})

describe('resolveCover', () => {
  const where = 'content/blog/demo/en.mdx'

  it('takes a 4:3 cover and finds its -dark partner', () => {
    const src = image('ui-light.webp', 1600, 1200)
    image('ui-dark.webp', 1600, 1200)
    expect(resolveCover(where, { cover: { src }, images: [] }, publicDir)).toEqual({ src, srcDark: '/blog/demo/ui-dark.webp' })
  })

  it('keeps an explicit srcDark and checks it too', () => {
    const src = image('a.png', 800, 600)
    const srcDark = image('b.png', 800, 600)
    expect(resolveCover(where, { cover: { src, srcDark }, images: [] }, publicDir)).toEqual({ src, srcDark })
    const wide = image('c.png', 1600, 524)
    expect(() => resolveCover(where, { cover: { src, srcDark: wide }, images: [] }, publicDir)).toThrow(/srcDark .*1600×524; covers are 4:3/)
  })

  it.each([
    ['a missing file', () => ({ src: '/blog/demo/nope.webp' }), /is not a file under public/],
    ['a wide strip', () => ({ src: image('strip.png', 1600, 524) }), /1600×524; covers are 4:3/],
    ['16:9', () => ({ src: image('wide.png', 1600, 900) }), /covers are 4:3/],
    ['a path outside /blog', () => ({ src: '/logo.png' }), /must be a \/blog\//],
  ])('rejects %s', (_, cover, message) => {
    expect(() => resolveCover(where, { cover: cover(), images: [] }, publicDir)).toThrow(message)
  })

  it('rejects focus and zoom: covers are shown whole', () => {
    const cover = readCover(`export const post = {
  cover: { src: '/blog/demo/x.webp', focus: '30% 40%', zoom: 1.6 },
}`)
    expect(cover).toMatchObject({ src: '/blog/demo/x.webp', extra: ['focus', 'zoom'] })
    image('x.webp', 1600, 1200)
    expect(() => resolveCover(where, { cover, images: [] }, publicDir)).toThrow(/unknown field\(s\) focus, zoom/)
  })

  it('without a cover: the first 4:3 capture, skipping wide strips and missing files', () => {
    const strip = image('bookmarks.png', 1600, 524)
    const ui = image('tm-light.png', 1600, 1200)
    image('tm-dark.png', 1600, 1200)
    expect(resolveCover(where, { cover: undefined, images: ['/blog/demo/missing.webp', strip, ui] }, publicDir)).toEqual({ src: ui, srcDark: '/blog/demo/tm-dark.png' })
  })

  it('without a cover or any 4:3 capture: nothing (the card shows the mark, never a cropped strip)', () => {
    const strip = image('bookmarks.png', 1600, 524)
    expect(resolveCover(where, { cover: undefined, images: [strip] }, publicDir)).toBeUndefined()
  })

  it('a translation without its own cover uses the English one', () => {
    const content = mkdtempSync(join(tmpdir(), 'blog-content-'))
    try {
      const src = image('ui-light.png', 1600, 1200)
      const strip = image('strip.png', 1600, 524)
      const file = (cover: string) => `export const post = {
  slug: 'demo',
  title: 'Demo',
  published: '2026-11-19',
  images: [{ src: '${strip}', alt: 'Strip' }],
${cover}  tags: ['chrome', 'save-tabs', 'bookmarks'],
}

Text.
`
      mkdirSync(join(content, 'demo'))
      writeFileSync(join(content, 'demo', 'en.mdx'), file(`  cover: { src: '${src}' },\n`))
      writeFileSync(join(content, 'demo', 'de.mdx'), file(''))
      const posts = scanBlogContent(content, { placeholders: false, publicDir })
      expect(posts.demo.en.cover).toEqual({ src })
      expect(posts.demo.de.cover).toEqual({ src })
    } finally {
      rmSync(content, { recursive: true, force: true })
    }
  })
})

describe('the generated covers', () => {
  it('the real post shows the save-session dialog pair, in every locale', () => {
    for (const source of Object.values(GENERATED['save-all-open-tabs'])) {
      expect(source.cover).toEqual({
        src: '/blog/save-all-open-tabs/tm-save-session-dialog-light.webp',
        srcDark: '/blog/save-all-open-tabs/tm-save-session-dialog-dark.webp',
      })
    }
  })

  it('every generated cover is a 4:3 file', () => {
    for (const locales of Object.values(GENERATED)) {
      for (const { cover } of Object.values(locales)) {
        for (const src of [cover?.src, cover?.srcDark].filter(Boolean) as string[]) {
          const size = imageSize(join(PUBLIC_DIR, ...src.split('/').filter(Boolean)))!
          expect(isCoverRatio(size.width, size.height), src).toBe(true)
        }
      }
    }
  })

  it('cardCover: the shown file, else English, else none', () => {
    const post = { slug: 'demo', images: [{ src: '/blog/demo/strip.webp', alt: 'x' }] } as unknown as Post
    const sources = {
      demo: { en: { cover: { src: '/blog/demo/en.webp' } }, de: { cover: { src: '/blog/demo/de.webp' } }, fr: {} },
    } as never
    expect(cardCover({ post, contentLocale: 'de' }, sources)).toEqual({ src: '/blog/demo/de.webp' })
    expect(cardCover({ post, contentLocale: 'fr' }, sources)).toEqual({ src: '/blog/demo/en.webp' })
    expect(cardCover({ post, contentLocale: 'en' }, { demo: { en: {} } } as never)).toBeNull()
  })
})

describe('CoverImage', () => {
  const imgs = (container: HTMLElement) => [...container.querySelectorAll('img')]

  it('shows the whole image: object-contain, no crop, position or zoom styles', () => {
    const { container } = render(<CoverImage cover={{ src: '/blog/demo/a.webp' }} sizes="100vw" />)
    const [img] = imgs(container)
    expect(img).toHaveClass('object-contain')
    expect(img.className).not.toMatch(/object-cover|object-\[|origin-/)
    expect(img.style.objectPosition).toBe('')
    expect(img.style.transform).toBe('')
    expect(img.getAttribute('style') ?? '').not.toMatch(/zoom|object-position|transform/)
    expect(img).toHaveAttribute('alt', '')
  })

  it('a theme pair: both in the HTML, CSS shows one, both lazy so the hidden one is not fetched', () => {
    const { container } = render(<CoverImage cover={{ src: '/blog/demo/l.webp', srcDark: '/blog/demo/d.webp' }} eager sizes="100vw" />)
    const [light, dark] = imgs(container)
    expect(light.getAttribute('src')).toContain('/blog/demo/l.webp')
    expect(light).toHaveClass('dark:hidden')
    expect(dark.getAttribute('src')).toContain('/blog/demo/d.webp')
    expect(dark).toHaveClass('hidden', 'dark:block')
    expect(light).toHaveAttribute('loading', 'lazy')
    expect(dark).toHaveAttribute('loading', 'lazy')
    expect(light).toHaveAttribute('fetchpriority', 'high')
  })

  it('a single eager image loads eagerly', () => {
    const { container } = render(<CoverImage cover={{ src: '/blog/demo/a.webp' }} eager sizes="100vw" />)
    expect(imgs(container)[0]).toHaveAttribute('loading', 'eager')
  })

  it('grows 3% on card hover or focus only without reduced motion', () => {
    const { container } = render(<CoverImage cover={{ src: '/blog/demo/a.webp' }} sizes="100vw" />)
    const classes = imgs(container)[0].className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['motion-safe:group-hover:scale-[1.03]', 'motion-safe:group-focus-within:scale-[1.03]']))
    // Every scale or transition class is behind motion-safe.
    for (const name of classes.filter((c) => /scale|transition|duration|ease/.test(c))) expect(name.startsWith('motion-safe:'), name).toBe(true)
  })

  it('no cover: the TabMerger mark on the frame surface', () => {
    const { container } = render(<CoverImage cover={null} sizes="100vw" />)
    expect(container.querySelector('[data-cover-placeholder]')).not.toBeNull()
    expect(imgs(container)[0].getAttribute('src')).toContain('/logo.png')
  })
})
