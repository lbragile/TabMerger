import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { DemoWindowCard } from '@/components/marketing/demo/DemoWindowCard'

const win = {
  id: 2,
  incognito: false,
  focused: false,
  starred: false,
  name: 'Main',
  tabs: [{ id: 1, title: 'GitHub', url: 'https://github.com' }],
}

function renderCard(overrides = {}) {
  const props = {
    window: win,
    groupColor: 'rgba(0,180,204,1)',
    sortableId: 'window-2',
    onStarToggle: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onTabDelete: vi.fn(),
    canDelete: true,
    ...overrides,
  }
  render(
    <DndContext>
      <SortableContext items={['window-2']}>
        <DemoWindowCard {...props} />
      </SortableContext>
    </DndContext>
  )
  return props
}

describe('DemoWindowCard', () => {
  it('renders the window name and tab count', () => {
    renderCard()
    expect(screen.getByText('Main')).toBeInTheDocument()
    expect(screen.getByText('1 tab')).toBeInTheDocument()
  })

  it('calls onStarToggle when the star is clicked', () => {
    const props = renderCard()
    fireEvent.click(screen.getByTitle('Star window'))
    expect(props.onStarToggle).toHaveBeenCalledOnce()
  })

  it('enters rename mode on double-click and commits on Enter', () => {
    const props = renderCard()
    fireEvent.doubleClick(screen.getByText('Main'))
    const input = screen.getByDisplayValue('Main')
    fireEvent.change(input, { target: { value: 'Renamed Window' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('Renamed Window')
  })

  it('hides the delete button when canDelete is false', () => {
    renderCard({ canDelete: false })
    expect(screen.queryByTitle('Remove window')).not.toBeInTheDocument()
  })

  it('renders child tabs via DemoTabRow', () => {
    renderCard()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })
})
