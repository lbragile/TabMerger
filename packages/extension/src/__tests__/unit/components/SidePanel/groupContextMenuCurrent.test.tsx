import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GroupContextMenu } from '@/components/SidePanel/GroupContextMenu'
import type { Group } from '@/lib/types'

vi.mock('@/lib/localDb', () => ({ getSetting: vi.fn().mockResolvedValue(undefined), setSetting: vi.fn().mockResolvedValue(undefined) }))

const group: Group = { id: 'g1', name: 'Reading', color: 'rgba(1, 2, 3, 1)', updatedAt: 1, windows: [] }

function renderRow(wrapperCurrent?: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <GroupContextMenu group={group} groupIndex={1} open={false} onOpenChange={vi.fn()} wrapperCurrent={wrapperCurrent}>
          <span>row</span>
        </GroupContextMenu>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe('GroupContextMenu — wrapperCurrent', () => {
  it('marks its row aria-current="page" when it is the current row', () => {
    renderRow(true)
    expect(screen.getByRole('button', { name: 'Reading' })).toHaveAttribute('aria-current', 'page')
  })

  it('has no aria-current by default or when false', () => {
    const { unmount } = renderRow()
    expect(screen.getByRole('button', { name: 'Reading' })).not.toHaveAttribute('aria-current')
    unmount()
    renderRow(false)
    expect(screen.getByRole('button', { name: 'Reading' })).not.toHaveAttribute('aria-current')
  })
})
