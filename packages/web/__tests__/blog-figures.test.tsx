/**
 * The blog's figures: automatic numbering (the rehype plugin), annotation markers and legends, alt
 * text, and the layout rule of at most two images in a row. The post-wide checks run over every
 * post and locale file that exists (rendered from the real MDX), so a new post or translation is
 * held to the same rules.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'
import { AnnotatedFigure } from '@/components/blog/AnnotatedFigure'
import { FigureGrid } from '@/components/blog/FigureFrame'
import { BlogPostStateProvider } from '@/components/blog/BlogPostState'
import { FigureLightbox } from '@/components/blog/FigureLightbox'
import { ThemedScreenshot } from '@/components/blog/ThemedScreenshot'
import rehypeFigureNumbers, { FIGURE_COMPONENTS } from '@/lib/blog/mdx/rehype-figure-numbers.mjs'
import { figureBoxes, figureNumber, numberBoxes } from '@/lib/blog/figures'
import { blogFiles, loadBlogFile } from './helpers/blogMdx'

// ── The rehype plugin, on hand-built trees ────────────────────────────────────────────────────
type Node = { type: string; name?: string; attributes?: { type: string; name: string; value: string }[]; children?: Node[] }
const jsx = (name: string, children: Node[] = []): Node => ({ type: 'mdxJsxFlowElement', name, attributes: [], children })
const figureOf = (node: Node) => node.attributes?.find((a) => a.name === 'figure')?.value
const run = (root: Node) => (rehypeFigureNumbers() as (tree: Node) => void)(root)
const text = (value: string): Node => ({ type: 'text', children: [], name: value })

describe('rehype-figure-numbers', () => {
  it('numbers the figure components 1..N in document order, without gaps', () => {
    const a = jsx('AnnotatedFigure')
    const b = jsx('ThemedScreenshot')
    const c = jsx('AnnotatedFigure')
    run({ type: 'root', children: [a, { type: 'element', children: [text('x'), b] }, jsx('Section', [c])] })
    expect([a, b, c].map(figureOf)).toEqual(['1', '2', '3'])
  })

  it('knows which components are figures', () => {
    expect(FIGURE_COMPONENTS).toEqual(['AnnotatedFigure', 'ThemedScreenshot'])
  })

  it('gives every browser panel of one group the same starting number, and moves on by the longest panel', () => {
    const before = jsx('AnnotatedFigure')
    const chrome = jsx('AnnotatedFigure')
    const edgeOne = jsx('AnnotatedFigure')
    const edgeTwo = jsx('AnnotatedFigure')
    const after = jsx('AnnotatedFigure')
    const nextGroupChrome = jsx('AnnotatedFigure')
    const nextGroupFirefox = jsx('AnnotatedFigure')
    run({
      type: 'root',
      children: [
        before,
        jsx('BrowserPanels', [jsx('BrowserPanel', [chrome]), jsx('BrowserPanel', [edgeOne, edgeTwo])]),
        after,
        jsx('BrowserPanels', [jsx('BrowserPanel', [nextGroupChrome]), jsx('BrowserPanel', [nextGroupFirefox])]),
      ],
    })
    expect(figureOf(before)).toBe('1')
    expect([chrome, edgeOne, edgeTwo].map(figureOf)).toEqual(['2', '2', '3'])
    expect(figureOf(after)).toBe('4')
    expect([nextGroupChrome, nextGroupFirefox].map(figureOf)).toEqual(['5', '5'])
  })

  it('numbers each carousel slide separately', () => {
    const slides = [jsx('AnnotatedFigure'), jsx('AnnotatedFigure'), jsx('ThemedScreenshot')]
    const last = jsx('AnnotatedFigure')
    run({ type: 'root', children: [jsx('Carousel', slides), last] })
    expect([...slides, last].map(figureOf)).toEqual(['1', '2', '3', '4'])
  })

  it('replaces a hand-written figure prop instead of adding a second one', () => {
    const f = jsx('AnnotatedFigure')
    f.attributes = [{ type: 'mdxJsxAttribute', name: 'figure', value: '99' }]
    run({ type: 'root', children: [f] })
    expect(f.attributes.filter((a) => a.name === 'figure')).toEqual([{ type: 'mdxJsxAttribute', name: 'figure', value: '1' }])
  })

  it('leaves a tree without figures untouched', () => {
    const p = jsx('p')
    run({ type: 'root', children: [p] })
    expect(p.attributes).toEqual([])
  })
})

describe('figureNumber', () => {
  it('reads the string the plugin writes, and rejects anything else', () => {
    expect(figureNumber('3')).toBe(3)
    expect(figureNumber(4)).toBe(4)
    for (const bad of [undefined, '0', '-1', '1.5', 'x', null, NaN]) expect(figureNumber(bad)).toBeUndefined()
  })
})

// ── Markers and legends ───────────────────────────────────────────────────────────────────────
const SRC = '/blog/demo/shot.webp'
const caption = 'The settings page after the change.'
const box = (label: string, l: number, t: number) => ({ label, l, t, w: 10, h: 5 })

function figure(boxes: ReturnType<typeof box>[], extra: Record<string, unknown> = {}) {
  return render(
    <FigureLightbox>
      <AnnotatedFigure src={SRC} alt="Settings page" width={1600} height={900} boxes={boxes} figure="2" {...extra}>
        {caption}
      </AnnotatedFigure>
    </FigureLightbox>
  )
}

describe('markers and legends', () => {
  it('a figure with one box shows the box only: no badge, no legend, and the caption is not repeated', () => {
    const { container } = figure([box('Startup option', 10, 10)])
    expect(container.querySelector('figure ol')).toBeNull()
    expect(container.querySelectorAll('[aria-hidden="true"]:not(svg)').length).toBeGreaterThan(0)
    const overlay = container.querySelector('button span[aria-hidden="true"]')!
    expect(overlay.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0)
    expect(overlay.textContent).toBe('')
    expect(container.querySelector('figcaption')).toHaveTextContent('Figure 2 The settings page after the change.')
  })

  it('with two or more boxes numbers the badges 1..n in reading order and lists one legend entry per marker', () => {
    const { container } = figure([box('Second row', 50, 40), box('First row', 10, 10), box('First row, right', 60, 10)])
    const overlay = container.querySelector('button span[aria-hidden="true"]')!
    expect([...overlay.querySelectorAll('span[aria-hidden="true"]')].map((b) => b.textContent).filter(Boolean)).toEqual(['1', '2', '3'])
    const items = within(container.querySelector('figcaption ol')!).getAllByRole('listitem')
    expect(items.map((li) => li.textContent?.replace(/^\d/, '').replace(/^Marker \d: /, '').trim())).toEqual([
      'First row',
      'First row, right',
      'Second row',
    ])
    expect(items[0]).toHaveTextContent('Marker 1:')
  })

  it('shows the figure number in the caption, and none for a figure the plugin has not numbered', () => {
    expect(figure([]).container.querySelector('figcaption')).toHaveTextContent('Figure 2')
    const plain = render(
      <AnnotatedFigure src={SRC} alt="Alt" width={10} height={10}>
        Caption
      </AnnotatedFigure>
    )
    expect(plain.container.querySelector('figcaption')?.textContent).not.toMatch(/Figure/)
  })

  it('numbers boxes by reading order: top to bottom, left to right within a row', () => {
    const boxes = numberBoxes([{ l: 50, t: 1, w: 1, h: 1 }, { l: 5, t: 2, w: 1, h: 1 }, { l: 1, t: 30, w: 1, h: 1 }])
    expect(boxes.map((b) => [b.l, b.n])).toEqual([[5, 1], [50, 2], [1, 3]])
  })

  it('takes positions from the recorded boxes of the post and the light version of a themed capture', () => {
    const data = { demo: { 'shot-light': [{ id: 'a', l: 1, t: 2, w: 3, h: 4 }] } }
    expect(figureBoxes('/blog/demo/shot-dark.webp', [{ id: 'a', label: 'A' }], data)[0]).toMatchObject({ l: 1, t: 2, n: 1 })
    expect(figureBoxes('not-a-blog-path.webp', [{ id: 'a' }], data)).toEqual([])
  })
})

// ── Every post and locale file ────────────────────────────────────────────────────────────────
const files = blogFiles()
const compiled = await Promise.all(files.map(async (f) => ({ name: `${f.slug}/${f.locale}`, Content: (await loadBlogFile(f.slug, f.locale)).Content })))
const figuresIn = (container: HTMLElement) => [...container.querySelectorAll('figure')]
const numberOf = (el: Element) => Number(/^Figure (\d+)/.exec(el.querySelector('figcaption')?.textContent ?? '')?.[1])

describe.each(compiled.map((c) => [c.name, c.Content] as const))('%s: figures', (name, Content) => {
  let container: HTMLElement
  beforeEach(() => {
    container = render(
      <BlogPostStateProvider>
        <FigureLightbox>
          <Content />
        </FigureLightbox>
      </BlogPostStateProvider>
    ).container
  })

  it('has figures, numbered 1..N with no gaps', () => {
    const numbers = figuresIn(container).map(numberOf)
    expect(numbers.length).toBeGreaterThan(0)
    const distinct = [...new Set(numbers)].sort((a, b) => a - b)
    expect(distinct).toEqual(distinct.map((_, i) => i + 1))
  })

  it('shows browser alternatives under one number, and every other figure under its own', () => {
    const owners = new Map<number, Set<Element>>()
    for (const fig of figuresIn(container)) {
      const panel = fig.closest('[role="tabpanel"]')
      const owner = panel ?? fig
      const set = owners.get(numberOf(fig)) ?? new Set()
      set.add(owner)
      owners.set(numberOf(fig), set)
    }
    for (const [, set] of owners) {
      if (set.size > 1) for (const owner of set) expect(owner.getAttribute('role')).toBe('tabpanel')
    }
  })

  it('gives each carousel slide its own figure number', () => {
    for (const carousel of container.querySelectorAll('section[aria-roledescription]')) {
      const numbers = [...carousel.querySelectorAll('figure')].map(numberOf)
      expect(new Set(numbers).size).toBe(numbers.length)
    }
  })

  it('gives every figure alt text, a description and one legend entry per numbered marker', () => {
    for (const fig of figuresIn(container)) {
      const imgs = [...fig.querySelectorAll('img')]
      expect(imgs.length).toBeGreaterThan(0)
      for (const img of imgs) expect(img.getAttribute('alt')?.trim().length).toBeGreaterThan(0)
      const caption = fig.querySelector('figcaption')!
      const legend = [...caption.querySelectorAll('ol > li')]
      const description = [...caption.querySelectorAll(':scope > span.block, :scope > span.flex')].find((el) => !el.matches('.font-mono'))
      expect(description?.textContent?.replace(/^Figure \d+/, '').trim().length).toBeGreaterThan(0)
      const overlay = fig.querySelector('button span[aria-hidden="true"]')
      const badges = [...(overlay?.querySelectorAll('span[aria-hidden="true"]') ?? [])].filter((b) => /^\d+$/.test(b.textContent ?? ''))
      // Markers are numbered only when there are two or more; then each has exactly one legend row.
      expect(legend).toHaveLength(badges.length)
      if (badges.length > 0) expect(badges.length).toBeGreaterThan(1)
    }
  })

  it('names each marker with a legend label; in English it is 2 to 5 words that the caption does not already contain', () => {
    const english = name.endsWith('/en')
    for (const fig of figuresIn(container)) {
      const caption = fig.querySelector('figcaption')!
      const prose = (caption.querySelector(':scope > span.block')?.textContent ?? '').toLowerCase()
      for (const li of caption.querySelectorAll('ol > li')) {
        const label = (li.textContent ?? '').replace(/^\d+/, '').replace(/^\s*Marker \d+:?\s*/, '').trim()
        expect(label.length).toBeGreaterThan(0)
        if (!english) continue
        const words = label.split(/\s+/)
        expect(words.length).toBeGreaterThanOrEqual(2)
        expect(words.length).toBeLessThanOrEqual(5)
        expect(prose).not.toContain(label.toLowerCase())
      }
    }
  })

  it('has themed screenshots with a light and a dark capture and different alt text for each (naming the theme in English)', () => {
    for (const fig of figuresIn(container)) {
      const imgs = [...fig.querySelectorAll('img')]
      if (imgs.length !== 2) continue
      const [light, dark] = imgs
      expect(light.getAttribute('src')).toMatch(/-light\.webp/)
      expect(dark.getAttribute('src')).toMatch(/-dark\.webp/)
      expect(light.getAttribute('alt')).not.toBe(dark.getAttribute('alt'))
      if (name.endsWith('/en')) {
        expect(light.getAttribute('alt')).toMatch(/light/i)
        expect(dark.getAttribute('alt')).toMatch(/dark/i)
      }
    }
  })

  it('never puts more than two images in a row', () => {
    for (const grid of container.querySelectorAll('.lg\\:grid-cols-2')) {
      expect(grid.children.length).toBeLessThanOrEqual(2)
    }
    expect(container.querySelector('[class*="grid-cols-3"], [class*="grid-cols-4"], [class*="lg:grid-cols-3"]')).toBeNull()
  })
})

describe('FigureGrid', () => {
  it('lays two figures side by side from 64rem and stacks them below', () => {
    const { container } = render(
      <FigureGrid>
        <AnnotatedFigure src={SRC} alt="One" width={10} height={10} />
        <AnnotatedFigure src={SRC} alt="Two" width={10} height={10} />
      </FigureGrid>
    )
    expect(container.firstElementChild).toHaveClass('grid', 'lg:grid-cols-2')
    expect(container.firstElementChild?.className).not.toMatch(/grid-cols-3/)
  })
})

describe('ThemedScreenshot', () => {
  it('renders a light and a dark capture, following the page theme in CSS', () => {
    const { container } = render(
      <ThemedScreenshot src="/blog/demo/tm" alt="Light theme view" darkAlt="Dark theme view" figure="1">
        Cap
      </ThemedScreenshot>
    )
    const [light, dark] = [...container.querySelectorAll('img')]
    expect(light).toHaveClass('dark:hidden')
    expect(dark).toHaveClass('hidden', 'dark:block')
    expect([light.alt, dark.alt]).toEqual(['Light theme view', 'Dark theme view'])
  })
})
