import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { DemoTabRow } from '@/components/marketing/demo/DemoTabRow'

const tab = { id: 1, title: 'GitHub — Pull Requests', url: 'https://github.com/pulls' }

function renderRow(onDelete = vi.fn()) {
  return render(
    <DndContext>
      <SortableContext items={['tab-2-1']}>
        <DemoTabRow tab={tab} sortableId="tab-2-1" onDelete={onDelete} />
      </SortableContext>
    </DndContext>
  )
}

describe('DemoTabRow', () => {
  it('renders the tab title and url', () => {
    renderRow()
    expect(screen.getByText('GitHub — Pull Requests')).toBeInTheDocument()
    expect(screen.getByText('https://github.com/pulls')).toBeInTheDocument()
  })

  it('renders a favicon image sourced from the s2 favicon service', () => {
    renderRow()
    const img = screen.getByRole('img', { hidden: true }) as HTMLImageElement
    expect(img.src).toContain('s2/favicons')
    expect(img.src).toContain('domain=github.com')
  })

  it('calls onDelete when the close button is clicked', () => {
    const onDelete = vi.fn()
    renderRow(onDelete)
    fireEvent.click(screen.getByTitle('Close tab'))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
