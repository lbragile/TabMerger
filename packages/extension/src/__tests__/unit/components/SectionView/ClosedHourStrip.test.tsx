import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ClosedHourStrip } from '@/components/SectionView/ClosedHourStrip'
import { SECTION_VIEW_TITLE_ATTR } from '@/components/SectionView/SectionViewHeader'

const counts = (pairs: [number, number][]) => {
  const c = new Array(24).fill(0)
  for (const [h, n] of pairs) c[h] = n
  return c
}

/** The strip under a view title, as in the day view. */
function View({ c, picked, onPick = vi.fn() }: { c: number[]; picked: number | null; onPick?: (h: number | null) => void }) {
  return (
    <div>
      <h2 tabIndex={-1} {...{ [SECTION_VIEW_TITLE_ATTR]: '' }}>Today</h2>
      <ClosedHourStrip counts={c} color="rgba(6, 182, 212, 1)" picked={picked} onPick={onPick} />
    </div>
  )
}

describe('ClosedHourStrip — focus when the pick goes away on its own', () => {
  it('no bar left: focus goes to the view title', () => {
    const { rerender } = render(<View c={counts([[9, 1]])} picked={9} />)
    act(() => screen.getByRole('button', { name: 'Show all hours' }).focus())
    rerender(<View c={counts([])} picked={null} />)
    expect(screen.getByRole('heading', { name: 'Today' })).toHaveFocus()
  })

  it('focus dropped to the page (the row it was on left): focus goes to the stop bar', () => {
    const { rerender } = render(<View c={counts([[9, 1], [11, 2]])} picked={9} />)
    expect(document.activeElement).toBe(document.body)
    rerender(<View c={counts([[11, 2]])} picked={null} />)
    expect(screen.getByRole('button', { name: /, 2 closed$/ })).toHaveFocus()
  })

  it('a new pick, or a pick still there, moves nothing', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { rerender } = render(<View c={counts([[9, 1], [11, 2]])} picked={null} />)
    act(() => outside.focus())
    rerender(<View c={counts([[9, 1], [11, 2]])} picked={11} />)
    rerender(<View c={counts([[9, 1], [11, 2]])} picked={11} />)
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('the status line wraps instead of clipping, and the link is at least 1.5rem tall', () => {
    render(<View c={counts([[9, 1]])} picked={9} />)
    const status = screen.getByTestId('closed-hour-status')
    expect(status.className).toContain('flex-wrap')
    expect(status.innerHTML).not.toContain('truncate')
    expect(screen.getByRole('button', { name: 'Show all hours' }).className).toContain('min-h-6')
  })
})
