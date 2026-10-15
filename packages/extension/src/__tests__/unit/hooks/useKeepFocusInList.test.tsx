import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { SEARCH_COPY } from '@tabmerger/shared'
import { SEARCH_STATUS_CLEAR_ATTR, useKeepFocusInList } from '@/hooks/useKeepFocusInList'

const { mockAnnounce } = vi.hoisted(() => ({ mockAnnounce: vi.fn() }))
vi.mock('@/lib/dndLiveRegion', () => ({ announceDnd: mockAnnounce }))

let setRows: (ids: string[]) => void = () => {}

function Harness({ enabled = true, initial = ['a', 'b', 'c'], withClear = true }: { enabled?: boolean; initial?: string[]; withClear?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [rows, set] = useState(initial)
  setRows = set
  const keep = useKeepFocusInList(ref, enabled)
  return (
    <div>
      {withClear && <button {...{ [SEARCH_STATUS_CLEAR_ATTR]: '' }}>Clear search</button>}
      <button id="elsewhere">Elsewhere</button>
      <div ref={ref} {...keep}>
        <div data-tm-dnd-list="l">
          {rows.map((id) => (
            <div key={id} data-tm-dnd-id={id} tabIndex={0} aria-label={`Row ${id}`}>
              {id}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const row = (id: string) => screen.getByLabelText(`Row ${id}`)
const focusRow = (id: string) => act(() => row(id).focus())
const remove = (...gone: string[]) => act(() => setRows(['a', 'b', 'c'].filter((x) => !gone.includes(x))))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useKeepFocusInList', () => {
  it('moves focus to the next row when the focused one disappears, and announces it', () => {
    render(<Harness />)
    focusRow('b')
    remove('b')
    expect(row('c')).toHaveFocus()
    expect(mockAnnounce).toHaveBeenCalledWith(SEARCH_COPY.focusMoved('Row c'))
  })

  it('falls back to the previous row when no later row is left', () => {
    render(<Harness />)
    focusRow('c')
    remove('c')
    expect(row('b')).toHaveFocus()
    expect(mockAnnounce).toHaveBeenCalledWith(SEARCH_COPY.focusMoved('Row b'))
  })

  it('skips over several removed rows to the nearest one still there', () => {
    render(<Harness />)
    focusRow('a')
    remove('a', 'b')
    expect(row('c')).toHaveFocus()
  })

  it('goes to the search status "Clear search" button when every row is gone', () => {
    render(<Harness />)
    focusRow('b')
    remove('a', 'b', 'c')
    expect(screen.getByRole('button', { name: 'Clear search' })).toHaveFocus()
    expect(mockAnnounce).toHaveBeenCalledWith(SEARCH_COPY.focusMoved('Clear search'))
  })

  it('does nothing when every row is gone and there is no clear button', () => {
    render(<Harness withClear={false} />)
    focusRow('b')
    remove('a', 'b', 'c')
    expect(document.body).toHaveFocus()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('is a no-op while disabled', () => {
    render(<Harness enabled={false} />)
    focusRow('b')
    remove('b')
    expect(document.body).toHaveFocus()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('does not steal focus that is already somewhere else', () => {
    render(<Harness />)
    focusRow('b')
    remove('b')
    // the move above happened; now focus a real element and remove its row
    act(() => document.getElementById('elsewhere')!.focus())
    mockAnnounce.mockClear()
    remove('b', 'c')
    expect(document.getElementById('elsewhere')).toHaveFocus()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('forgets the row after focus was moved on to a real element (blur with a related target)', () => {
    render(<Harness />)
    focusRow('b')
    act(() => document.getElementById('elsewhere')!.focus()) // blur -> relatedTarget is the button
    act(() => (document.activeElement as HTMLElement).blur()) // focus on body, as if lost later
    remove('b')
    expect(document.body).toHaveFocus()
    expect(mockAnnounce).not.toHaveBeenCalled()
  })

  it('ignores focus outside any list row (no record, nothing to restore)', () => {
    render(<Harness />)
    act(() => document.getElementById('elsewhere')!.focus())
    act(() => (document.activeElement as HTMLElement).blur())
    remove('b')
    expect(document.body).toHaveFocus()
  })
})
