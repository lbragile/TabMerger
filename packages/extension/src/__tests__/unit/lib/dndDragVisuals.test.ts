/**
 * dndDragVisuals.test.ts + dndMultiDrag registry — the SENSOR-AGNOSTIC drag visuals:
 * the row-clone ghost (with a `+N` count badge and stacked cards for a multi-item drag)
 * and the exact collapse / restore of every dragged row.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildDragGhost, collapseRows, dragRowKind, measureRows, outerHeight } from '@/lib/dndDragVisuals'
import {
  DND_ROW_ID_ATTR,
  clearDndDragSelection,
  findSelectionRows,
  getDndDragCount,
  getDndDragSelection,
  setDndDragSelection
} from '@/lib/dndMultiDrag'

function rect(top: number, height: number, width = 300): DOMRect {
  return { top, bottom: top + height, left: 10, right: 10 + width, width, height, x: 10, y: top, toJSON: () => ({}) } as DOMRect
}

function tabRow(id: string, top = 0, height = 24): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('role', 'listitem')
  row.setAttribute('data-window-index', '0')
  row.setAttribute(DND_ROW_ID_ATTR, id)
  row.id = `row-${id}`
  row.className = 'group flex items-center'
  row.innerHTML = `<span draggable="true" aria-label="Drag to reorder tab">::</span><img src="x.png"><span data-testid="title">${id}</span>`
  row.getBoundingClientRect = () => rect(top, height)
  return row
}

beforeEach(() => {
  document.body.innerHTML = ''
  clearDndDragSelection()
})

describe('buildDragGhost', () => {
  it('single item: the wrapper IS the card — a sanitized clone, no badge, no stacked cards', () => {
    const row = tabRow('g::w0::t0')
    const ghost = buildDragGhost(row, rect(0, 24))
    expect(ghost.getAttribute('data-testid')).toBe('drag-ghost')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.hasAttribute('inert')).toBe(true)
    expect(ghost.querySelector('[data-testid="drag-ghost-count"]')).toBeNull()
    expect(ghost.querySelectorAll('[data-testid="drag-ghost-stack"]')).toHaveLength(0)
    const clone = ghost.firstElementChild as HTMLElement
    expect(clone.className).toBe(row.className)
    expect(clone.hasAttribute(DND_ROW_ID_ATTR)).toBe(false)
    expect(clone.hasAttribute('id')).toBe(false)
    expect(ghost.querySelector('[draggable]')).toBeNull()
    expect(ghost.querySelector('[data-testid="title"]')).toBeNull()
    expect(ghost.style.width).toBe('300px')
  })

  it('strips data-tm-move-source from the cloned row and from any descendant', () => {
    const row = tabRow('g::w0::t0')
    row.setAttribute('data-tm-move-source', '')
    row.querySelector('img')!.setAttribute('data-tm-move-source', '')
    const ghost = buildDragGhost(row, rect(0, 24))
    expect(ghost.hasAttribute('data-tm-move-source')).toBe(false)
    expect(ghost.querySelector('[data-tm-move-source]')).toBeNull()
    // the source row itself is left untouched
    expect(row.hasAttribute('data-tm-move-source')).toBe(true)
  })

  it('also strips it from a multi-item ghost', () => {
    const row = tabRow('g::w0::t0')
    row.setAttribute('data-tm-move-source', '')
    const ghost = buildDragGhost(row, rect(0, 24), { count: 3 })
    expect(ghost.querySelector('[data-tm-move-source]')).toBeNull()
  })

  it('multi item: a `+N` badge (N = the OTHER items), two stacked cards behind a solid front card holding the clone', () => {
    const ghost = buildDragGhost(tabRow('g::w0::t0'), rect(0, 24), { count: 4 })
    const badge = ghost.querySelector('[data-testid="drag-ghost-count"]') as HTMLElement
    expect(badge.textContent).toBe('+3')
    // contrast: foreground-on-background, not white-on-primary (~3:1 for 11px text)
    expect(badge.className).toContain('bg-foreground')
    expect(badge.className).toContain('text-background')
    expect(badge.className).not.toContain('bg-primary')
    // top-LEFT (next to the cursor) — the ghost's right edge often runs past the popup edge
    expect(badge.style.left).toBe('-9px')
    expect(badge.style.right).toBe('')
    expect(ghost.querySelectorAll('[data-testid="drag-ghost-stack"]')).toHaveLength(2)
    const front = ghost.querySelector('[data-testid="drag-ghost-front"]') as HTMLElement
    expect(front.className).toContain('bg-card')
    expect(front.querySelector('[role="listitem"]')).not.toBeNull()
  })

  it('two items → one stacked card; theme colours only via classes, never a raw var(--token) inline', () => {
    const ghost = buildDragGhost(tabRow('g::w0::t0'), rect(0, 24), { count: 2 })
    expect(ghost.querySelectorAll('[data-testid="drag-ghost-stack"]')).toHaveLength(1)
    expect(ghost.querySelector('[data-testid="drag-ghost-count"]')!.textContent).toBe('+1')
    expect(ghost.outerHTML).not.toMatch(/var\(--/)
  })

  it('a tall WINDOW ghost is clamped to 440px with a fade; width falls back when the rect is empty', () => {
    const w = document.createElement('div')
    w.setAttribute('data-window-index', '0')
    const ghost = buildDragGhost(w, rect(0, 900, 0), { count: 3 })
    const front = ghost.querySelector('[data-testid="drag-ghost-front"]') as HTMLElement
    expect(front.style.maxHeight).toBe('440px')
    expect(front.style.overflow).toBe('hidden')
    expect(ghost.style.width).toBe('200px')
  })

  it('a clone <img> that fails to load is hidden', () => {
    const ghost = buildDragGhost(tabRow('g::w0::t0'), rect(0, 24))
    const img = ghost.querySelector('img') as HTMLImageElement
    img.dispatchEvent(new Event('error'))
    expect(img.style.visibility).toBe('hidden')
  })
})

describe('collapseRows / measureRows', () => {
  it('measures id, rect and OUTER height (margins included) before collapsing; skips detached rows', () => {
    const a = tabRow('g::w0::t0', 0, 24)
    a.style.marginBottom = '4px'
    const detached = tabRow('g::w0::t9')
    document.body.append(a)
    const measured = measureRows([a, detached])
    expect(measured).toHaveLength(1)
    expect(measured[0]).toMatchObject({ id: 'g::w0::t0', height: 28, rect: { top: 0, bottom: 24 } })
    expect(outerHeight(a)).toBe(28)
  })

  it('collapses every row out of the layout and restores each row\'s prior inline values EXACTLY (value + priority); restore is idempotent', () => {
    const a = tabRow('g::w0::t0')
    const b = tabRow('g::w0::t1')
    a.style.setProperty('height', '30px', 'important')
    b.style.visibility = 'visible'
    document.body.append(a, b)
    const handle = collapseRows(measureRows([a, b]))
    for (const r of [a, b]) {
      expect(r.style.getPropertyValue('height')).toBe('0px')
      expect(r.style.getPropertyPriority('height')).toBe('important')
      expect(r.style.getPropertyValue('visibility')).toBe('hidden')
    }
    handle.restore()
    expect(a.style.getPropertyValue('height')).toBe('30px')
    expect(a.style.getPropertyPriority('height')).toBe('important')
    expect(a.style.getPropertyValue('visibility')).toBe('')
    expect(b.style.getPropertyValue('visibility')).toBe('visible')
    expect(b.style.getPropertyValue('height')).toBe('')
    b.style.visibility = 'collapse'
    handle.restore()
    expect(b.style.visibility).toBe('collapse')
  })

  it('dragRowKind', () => {
    const g = document.createElement('div')
    g.setAttribute('data-sidebar-group-index', '1')
    expect(dragRowKind(g)).toBe('group')
    expect(dragRowKind(tabRow('x'))).toBe('tab')
    expect(dragRowKind(document.createElement('div'))).toBe('window')
  })
})

describe('dndMultiDrag registry', () => {
  it('≤1 id is a single-item drag; >1 records the set; clear resets', () => {
    setDndDragSelection('a', ['a'])
    expect(getDndDragSelection()).toBeNull()
    expect(getDndDragCount()).toBe(1)
    setDndDragSelection('a', ['a', 'b', 'c'])
    expect([...getDndDragSelection()!]).toEqual(['a', 'b', 'c'])
    expect(getDndDragCount()).toBe(3)
    clearDndDragSelection()
    expect(getDndDragCount()).toBe(1)
    setDndDragSelection('a', undefined)
    expect(getDndDragSelection()).toBeNull()
  })

  it('findSelectionRows: the OTHER rendered selected rows in DOM order (primary excluded, unrendered ones absent)', () => {
    const rows = ['g::w0::t0', 'g::w0::t1', 'g::w1::t0', 'g::w1::t1'].map((id) => tabRow(id))
    document.body.append(...rows)
    setDndDragSelection('g::w1::t0', ['g::w1::t0', 'g::w0::t1', 'g::w1::t1', 'other::w0::t0'])
    expect(findSelectionRows(document, rows[2])).toEqual([rows[1], rows[3]])
    expect(findSelectionRows(null, rows[2])).toEqual([])
    clearDndDragSelection()
    expect(findSelectionRows(document)).toEqual([])
  })
})
