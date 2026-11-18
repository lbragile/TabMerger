import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { READ_ONLY_ROW_ATTR, READ_ONLY_TAB_ATTR, handleReadOnlyListKeyDown } from '@/lib/readOnlyListKeys'

function List() {
  const row = (n: number) => (
    <li key={n} {...{ [READ_ONLY_ROW_ATTR]: '' }}>
      <button type="button" {...{ [READ_ONLY_TAB_ATTR]: '' }}>{`Row ${n}`}</button>
      <button type="button">{`Chevron ${n}`}</button>
      <button
        type="button"
        // a menu button: opens its menu on ArrowDown (and says so by consuming it)
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') e.preventDefault()
        }}
      >{`More ${n}`}</button>
    </li>
  )
  return (
    <ul onKeyDown={handleReadOnlyListKeyDown}>
      {[1, 2, 3].map(row)}
      <li>
        <button type="button">Elsewhere</button>
      </li>
    </ul>
  )
}

describe('handleReadOnlyListKeyDown across a row', () => {
  it('from a row button that is not in the arrow list (a chevron), Down goes to the next row', () => {
    render(<List />)
    const chevron = screen.getByRole('button', { name: 'Chevron 1' })
    chevron.focus()
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    chevron.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(screen.getByRole('button', { name: 'Row 2' })).toHaveFocus()
  })

  it('from a ⋯ menu button, Up/Home/End move between rows and ArrowDown is left to the menu', () => {
    render(<List />)
    const more = screen.getByRole('button', { name: 'More 2' })
    more.focus()
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    expect(more).toHaveFocus()
    fireEvent.keyDown(more, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Row 1' })).toHaveFocus()
    screen.getByRole('button', { name: 'More 2' }).focus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'More 2' }), { key: 'End' })
    expect(screen.getByRole('button', { name: 'Row 3' })).toHaveFocus()
  })

  it('a button outside any row is left alone', () => {
    render(<List />)
    const other = screen.getByRole('button', { name: 'Elsewhere' })
    other.focus()
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    other.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    expect(other).toHaveFocus()
  })
})
