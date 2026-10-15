import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Highlighted, SEARCH_MARK_CLASS } from '@/components/Highlighted'

const marks = (c: HTMLElement) => Array.from(c.querySelectorAll('mark')).map((m) => m.textContent)

describe('Highlighted', () => {
  it('marks the first contiguous match, case-insensitively, keeping the rest as plain text', () => {
    const { container } = render(<span><Highlighted text="Alpha beta ALPHA" query="alpha" /></span>)
    expect(marks(container)).toEqual(['Alpha'])
    expect(container.textContent).toBe('Alpha beta ALPHA')
  })

  it('marks nothing for letters that are only in the text out of sequence', () => {
    const { container } = render(<span><Highlighted text="Alpha beta" query="abt" /></span>)
    expect(container.querySelector('mark')).toBeNull()
    expect(container.textContent).toBe('Alpha beta')
  })

  it('marks the trimmed query, including a multi-word one, as one run', () => {
    const { container } = render(<span><Highlighted text="Open Jira board" query="  jira bo " /></span>)
    expect(marks(container)).toEqual(['Jira bo'])
  })

  it('renders the text unchanged when there is no query or no match', () => {
    const a = render(<span><Highlighted text="plain" /></span>)
    expect(a.container.querySelector('mark')).toBeNull()
    const b = render(<span><Highlighted text="plain" query="zzz" /></span>)
    expect(b.container.querySelector('mark')).toBeNull()
    expect(b.container.textContent).toBe('plain')
  })

  it('treats the query as plain text, never as a pattern or markup', () => {
    const { container } = render(<span><Highlighted text="a.b (c) <b>x</b>" query=".*" /></span>)
    expect(container.querySelector('mark')).toBeNull()
    const html = render(<span><Highlighted text="x <b>bold</b> y" query="<b>" /></span>)
    expect(html.container.querySelector('b')).toBeNull()
    expect(html.container.textContent).toBe('x <b>bold</b> y')
  })

  it('explicit ranges win over the query, and are clamped to the text', () => {
    const { container } = render(<span><Highlighted text="abcdef" query="zzz" ranges={[[1, 3], [5, 99]]} /></span>)
    expect(marks(container)).toEqual(['bc', 'f'])
    expect(container.textContent).toBe('abcdef')
  })

  it('skips empty, reversed or overlapping ranges instead of repeating text', () => {
    const { container } = render(<span><Highlighted text="abcdef" ranges={[[2, 2], [1, 4], [3, 5], [4, 1]]} /></span>)
    expect(container.textContent).toBe('abcdef')
    expect(marks(container)).toEqual(['bcd', 'e'])
  })

  it('marks carry the shared look and a marker attribute', () => {
    const { container } = render(<span><Highlighted text="abc" query="b" /></span>)
    const m = container.querySelector('mark')!
    expect(m).toHaveAttribute('data-search-mark')
    expect(m.className).toBe(SEARCH_MARK_CLASS)
  })
})
