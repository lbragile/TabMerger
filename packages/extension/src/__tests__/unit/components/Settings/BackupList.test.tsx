import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BackupList } from '@/components/Settings/BackupList'
import type { Group, Session } from '@/lib/types'

const group = (id: string, tabs = 2): Group => ({
  id, name: `G ${id}`, color: 'rgba(1, 2, 3, 1)', updatedAt: 1,
  windows: [{ id: 1, incognito: false, focused: false, tabs: Array.from({ length: tabs }, (_, i) => ({ id: 0, title: `t${i}`, url: `https://example.com/${id}/${i}` })) }],
})
const backup = (id: string, createdAt: number): Session => ({ id, name: id, groups: [group('a', 3)], createdAt, auto: true })

function setup(backups: Session[], restoreId: string | null = null) {
  const props = { onRestoreIdChange: vi.fn(), onRestore: vi.fn(), onDelete: vi.fn() }
  const utils = render(<BackupList backups={backups} formatDate={(ms) => `date-${ms}`} restoreId={restoreId} {...props} />)
  return { ...utils, ...props }
}

describe('BackupList', () => {
  it('renders nothing without backups', () => {
    const { container } = setup([])
    expect(container.firstChild).toBeNull()
  })

  it('uses the singular and plural label and starts collapsed', () => {
    const one = setup([backup('b1', 1)])
    const toggle = screen.getByTestId('backup-list-toggle')
    expect(toggle.textContent).toBe('1 saved backup')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    one.unmount()
    setup([backup('b1', 1), backup('b2', 2)])
    expect(screen.getByTestId('backup-list-toggle').textContent).toBe('2 saved backups')
  })

  it('opens and closes, with aria-controls pointing at the list container', () => {
    setup([backup('b1', 1)])
    const toggle = screen.getByTestId('backup-list-toggle')
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(panel.hidden).toBe(true)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel.hidden).toBe(false)
    fireEvent.click(toggle)
    expect(panel.hidden).toBe(true)
  })

  it('Restore toggles the choice: opens for a closed row, closes for the open row', () => {
    const a = setup([backup('b1', 1)])
    fireEvent.click(screen.getByTestId('backup-list-toggle'))
    fireEvent.click(document.querySelector('button[aria-expanded="false"][aria-label]:not([data-testid])') as HTMLElement)
    expect(a.onRestoreIdChange).toHaveBeenCalledWith('b1')
    a.unmount()
    const b = setup([backup('b1', 1)], 'b1')
    fireEvent.click(screen.getByTestId('backup-list-toggle'))
    fireEvent.click(document.querySelector('button[aria-expanded="true"][aria-label]:not([data-testid])') as HTMLElement)
    expect(b.onRestoreIdChange).toHaveBeenCalledWith(null)
  })

  it('the open choice offers Add, Replace and Cancel', () => {
    const { onRestore, onRestoreIdChange, onDelete } = setup([backup('b1', 1)], 'b1')
    fireEvent.click(screen.getByTestId('backup-list-toggle'))
    const group = screen.getByRole('group')
    const buttons = group.querySelectorAll('button')
    expect(buttons).toHaveLength(3)
    fireEvent.click(buttons[0])
    expect(onRestore).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b1' }), 'add')
    fireEvent.click(buttons[1])
    expect(onRestore).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b1' }), 'replace')
    fireEvent.click(buttons[2])
    expect(onRestoreIdChange).toHaveBeenCalledWith(null)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('Delete reports the backup and carries data-backup-delete', () => {
    const { onDelete } = setup([backup('b1', 1), backup('b2', 2)])
    fireEvent.click(screen.getByTestId('backup-list-toggle'))
    const del = document.querySelector('[data-backup-delete="b2"]') as HTMLElement
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b2' }))
    expect(document.querySelectorAll('[data-backup-delete]')).toHaveLength(2)
  })
})
