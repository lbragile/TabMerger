import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ImportExportModal } from '@/components/Modal/ImportExport'

const {
  mockUseGroups,
  mockSetGroupsState,
  mockImportGroupsMutateAsync,
  mockParseBookmarksHtml,
  mockParseOneTabs,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockUseGroups: vi.fn(),
  mockSetGroupsState: vi.fn().mockResolvedValue(undefined),
  mockImportGroupsMutateAsync: vi.fn().mockResolvedValue(undefined),
  mockParseBookmarksHtml: vi.fn(),
  mockParseOneTabs: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => mockUseGroups(),
  useSetGroupsState: () => mockSetGroupsState,
  useImportGroups: () => ({ mutateAsync: mockImportGroupsMutateAsync }),
}))

vi.mock('@/lib/importExport', () => ({
  parseBookmarksHtml: mockParseBookmarksHtml,
  parseOneTabs: mockParseOneTabs,
}))

vi.mock('@/lib/toast', () => ({ toast: { success: mockToastSuccess, error: mockToastError } }))

function renderModal(mode = 'export', onClose = vi.fn()) {
  render(<Dialog open><DialogContent><ImportExportModal mode={mode} data={{}} onClose={onClose} /></DialogContent></Dialog>)
  return { onClose }
}

function makeFile(content: string, name: string, type = 'application/json') {
  return new File([content], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseGroups.mockReturnValue({ data: { available: [{ name: 'g' }] } })
  globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('ImportExportModal — export', () => {
  it('defaults to the export tab and downloads JSON', () => {
    const { onClose } = renderModal('export')
    fireEvent.click(screen.getByRole('button', { name: /download json/i }))
    expect(mockToastSuccess).toHaveBeenCalledWith('Groups exported successfully')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ImportExportModal — import JSON', () => {
  it('defaults to the import tab when mode="import"', () => {
    renderModal('import')
    expect(screen.getByText(/import from a previously exported json file/i)).toBeTruthy()
  })

  it('imports a valid JSON export and replaces groups', async () => {
    const { onClose } = renderModal('import')
    const file = makeFile(JSON.stringify({ available: [{ name: 'x' }] }), 'export.json')
    const input = document.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mockSetGroupsState).toHaveBeenCalledWith({ available: [{ name: 'x' }] }))
    expect(mockToastSuccess).toHaveBeenCalledWith('Groups imported successfully')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error toast for invalid JSON and does not close', async () => {
    const { onClose } = renderModal('import')
    const file = makeFile('not json', 'bad.json')
    const input = document.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Invalid JSON file'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('rejects a JSON file missing "available"', async () => {
    renderModal('import')
    const file = makeFile(JSON.stringify({ foo: 'bar' }), 'bad.json')
    const input = document.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Invalid JSON file'))
    expect(mockSetGroupsState).not.toHaveBeenCalled()
  })
})

describe('ImportExportModal — import bookmarks HTML', () => {
  it('imports parsed bookmark groups and reports tab count', async () => {
    mockParseBookmarksHtml.mockReturnValue([{ windows: [{ tabs: [{}, {}] }] }])
    const { onClose } = renderModal('import')
    const file = makeFile('<html></html>', 'bookmarks.html', 'text/html')
    const input = document.querySelector('input[type="file"][accept=".html"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mockImportGroupsMutateAsync).toHaveBeenCalled())
    expect(mockToastSuccess).toHaveBeenCalledWith('Imported 1 group, 2 tabs')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows "No bookmarks found" when parsing yields no groups', async () => {
    mockParseBookmarksHtml.mockReturnValue([])
    renderModal('import')
    const file = makeFile('<html></html>', 'empty.html', 'text/html')
    const input = document.querySelector('input[type="file"][accept=".html"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('No bookmarks found'))
    expect(mockImportGroupsMutateAsync).not.toHaveBeenCalled()
  })
})

describe('ImportExportModal — import OneTab', () => {
  it('imports parsed OneTab groups', async () => {
    mockParseOneTabs.mockReturnValue([{ windows: [{ tabs: [{}] }] }])
    renderModal('import')
    const file = makeFile('https://a.com | A', 'onetab.txt', 'text/plain')
    const input = document.querySelector('input[type="file"][accept=".txt"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mockImportGroupsMutateAsync).toHaveBeenCalled())
    expect(mockToastSuccess).toHaveBeenCalledWith('Imported 1 group, 1 tab')
  })

  it('shows "No tabs found" when parsing yields no groups', async () => {
    mockParseOneTabs.mockReturnValue([])
    renderModal('import')
    const file = makeFile('', 'empty.txt', 'text/plain')
    const input = document.querySelector('input[type="file"][accept=".txt"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('No tabs found'))
  })
})
