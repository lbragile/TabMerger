/**
 * The blog's recorded annotation boxes (content/blog/<slug>/boxes.json, via generated/blog.ts) lie
 * inside their images, and the figures' numbering rules hold.
 */
import { describe, expect, it } from 'vitest'
import { BLOG_BOXES } from '@/generated/blog'
import { figureBoxes, numberBoxes } from '@/lib/blog/figures'

describe('recorded blog boxes', () => {
  const all = Object.entries(BLOG_BOXES).flatMap(([slug, images]) =>
    Object.entries(images).flatMap(([stem, boxes]) => boxes.map((box) => ({ where: `${slug}/${stem}#${box.id}`, box })))
  )

  it('has boxes for the first post', () => {
    expect(all.length).toBeGreaterThan(0)
  })

  it.each(all.map((b) => [b.where, b.box] as const))('%s lies within its image', (_, box) => {
    expect(box.l).toBeGreaterThanOrEqual(0)
    expect(box.t).toBeGreaterThanOrEqual(0)
    expect(box.w).toBeGreaterThan(0)
    expect(box.h).toBeGreaterThan(0)
    expect(box.l + box.w).toBeLessThanOrEqual(100)
    expect(box.t + box.h).toBeLessThanOrEqual(100)
  })
})

describe('figureBoxes', () => {
  const data = { post: { shot: [{ id: 'b', l: 50, t: 50, w: 10, h: 10 }, { id: 'a', l: 1, t: 1, w: 5, h: 5 }] } }

  it('takes positions from the recorded data, only for the ids the post lists, in recorded order', () => {
    const boxes = figureBoxes('/blog/post/shot.webp', [{ id: 'a', label: 'First' }], data)
    expect(boxes).toEqual([{ id: 'a', label: 'First', l: 1, t: 1, w: 5, h: 5, n: 1 }])
    expect(figureBoxes('/blog/post/shot.webp', [{ id: 'a' }, { id: 'b' }], data).map((b) => b.id)).toEqual(['b', 'a'])
  })

  it('never shows recorded labels, and drops listed ids that have no position', () => {
    expect(figureBoxes('/blog/post/shot.webp', [{ id: 'missing' }], data)).toEqual([])
  })

  it('numbers hand-placed boxes 1..n in reading order', () => {
    expect(numberBoxes([{ l: 50, t: 50, w: 1, h: 1 }, { l: 1, t: 1, w: 1, h: 1 }]).map((b) => [b.l, b.n])).toEqual([
      [1, 1],
      [50, 2],
    ])
  })
})
