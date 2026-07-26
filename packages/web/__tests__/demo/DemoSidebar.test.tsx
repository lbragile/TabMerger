import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { DemoSidebar } from '@/components/marketing/demo/DemoSidebar'

const groups = [
  { id: 'now-open', name: 'Now Open', color: 'rgba(128,128,128,1)', updatedAt: 0, permanent: true, windows: [{ id: 1, tabs: [{ id: 1, title: 'a', url: 'https://a.com' }], incognito: false, focused: false }] },
  { id: 'work', name: 'Work', color: 'rgba(0,180,204,1)', updatedAt: 0, windows: [{ id: 2, tabs: [], incognito: false, focused: false }] },
]

function renderSidebar(overrides = {}) {
  const props = {
    groups,
    activeGroupId: 'work',
    sortableIds: groups.map((g) => `group-${g.id}`),
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onAddGroup: vi.fn(),
    ...overrides,
  }
  render(
    <DndContext>
      <DemoSidebar {...props} />
    </DndContext>
  )
  return props
}

describe('DemoSidebar', () => {
  it('renders every group name', () => {
    renderSidebar()
    expect(screen.getByText('Now Open')).toBeInTheDocument()
    expect(screen.getByText('Work')).toBeInTheDocument()
  })

  it('calls onSelect when a group row is clicked', () => {
    const props = renderSidebar()
    fireEvent.click(screen.getByText('Now Open'))
    expect(props.onSelect).toHaveBeenCalledWith('now-open')
  })

  it('calls onAddGroup when the add button is clicked', () => {
    const props = renderSidebar()
    fireEvent.click(screen.getByTitle('Add group'))
    expect(props.onAddGroup).toHaveBeenCalledOnce()
  })

  it('does not allow renaming the permanent "Now Open" group', () => {
    renderSidebar()
    fireEvent.doubleClick(screen.getByText('Now Open'))
    expect(screen.queryByDisplayValue('Now Open')).not.toBeInTheDocument()
  })

  it('allows renaming a non-permanent group', () => {
    const props = renderSidebar()
    fireEvent.doubleClick(screen.getByText('Work'))
    const input = screen.getByDisplayValue('Work')
    fireEvent.change(input, { target: { value: 'Job' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('work', 'Job')
  })
})
