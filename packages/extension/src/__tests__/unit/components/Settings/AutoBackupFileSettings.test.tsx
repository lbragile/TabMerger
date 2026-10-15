import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BACKUP_FILE_COPY, DEFAULT_BACKUP_FILE_FOLDER, DEFAULT_BACKUP_FILE_PATTERN } from '@tabmerger/shared'
import { AutoBackupFileSettings } from '@/components/Settings/AutoBackupFileSettings'

const h = vi.hoisted(() => ({
  permitted: true,
  status: null as unknown,
  toastError: vi.fn(),
}))

vi.mock('@/lib/autoBackupFile', async () => ({
  ...(await vi.importActual<typeof import('@/lib/autoBackupFile')>('@/lib/autoBackupFile')),
  hasBackupFilePermission: async () => h.permitted,
}))
vi.mock('@/lib/localDb', () => ({ getSetting: async () => h.status }))
vi.mock('@/lib/toast', () => ({ toast: { error: (...a: unknown[]) => h.toastError(...a), success: vi.fn(), info: vi.fn() } }))

const FILE = { enabled: true, folder: DEFAULT_BACKUP_FILE_FOLDER, pattern: DEFAULT_BACKUP_FILE_PATTERN }
let request: ReturnType<typeof vi.fn>

function renderIt(props: Partial<{ file: typeof FILE; disabled: boolean; onSave: (p: unknown) => void }> = {}) {
  const onSave = props.onSave ?? vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AutoBackupFileSettings file={props.file ?? FILE} disabled={props.disabled ?? false} onSave={onSave} />
    </QueryClientProvider>
  )
  return { onSave }
}

beforeEach(() => {
  h.permitted = true
  h.status = null
  h.toastError.mockClear()
  request = vi.fn(async () => true)
  ;(globalThis as { chrome?: unknown }).chrome = { permissions: { request, contains: async () => h.permitted } }
})

const ready = () => screen.findByLabelText(BACKUP_FILE_COPY.folderLabel)
const folderInput = () => screen.getByLabelText(BACKUP_FILE_COPY.folderLabel) as HTMLInputElement
const patternInput = () => screen.getByLabelText(BACKUP_FILE_COPY.patternLabel) as HTMLInputElement

describe('AutoBackupFileSettings', () => {
  it('off: only the switch shows, no folder or pattern fields', async () => {
    renderIt({ file: { ...FILE, enabled: false } })
    expect(await screen.findByRole('switch', { name: BACKUP_FILE_COPY.toggle })).not.toBeChecked()
    expect(screen.queryByLabelText(BACKUP_FILE_COPY.folderLabel)).toBeNull()
  })

  it('turning it on asks the browser for the downloads permission FIRST, then saves', async () => {
    const { onSave } = renderIt({ file: { ...FILE, enabled: false } })
    fireEvent.click(await screen.findByRole('switch', { name: BACKUP_FILE_COPY.toggle }))
    expect(request).toHaveBeenCalledWith({ permissions: ['downloads'] })
    expect(onSave).not.toHaveBeenCalled()
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ autoBackupFileEnabled: true }))
  })

  it('permission denied: nothing is saved and the user is told', async () => {
    request.mockResolvedValue(false)
    const { onSave } = renderIt({ file: { ...FILE, enabled: false } })
    fireEvent.click(await screen.findByRole('switch', { name: BACKUP_FILE_COPY.toggle }))
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(BACKUP_FILE_COPY.permissionDenied))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a permission request that throws is the same as denied', async () => {
    request.mockRejectedValue(new Error('nope'))
    const { onSave } = renderIt({ file: { ...FILE, enabled: false } })
    fireEvent.click(await screen.findByRole('switch', { name: BACKUP_FILE_COPY.toggle }))
    await waitFor(() => expect(h.toastError).toHaveBeenCalled())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('turning it off saves without asking for anything', async () => {
    const { onSave } = renderIt()
    await ready()
    fireEvent.click(screen.getByRole('switch', { name: BACKUP_FILE_COPY.toggle }))
    expect(request).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith({ autoBackupFileEnabled: false })
  })

  it('saved as on but the browser permission is gone: the switch shows off and says why', async () => {
    h.permitted = false
    renderIt()
    expect(await screen.findByText(BACKUP_FILE_COPY.permissionRevoked)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: BACKUP_FILE_COPY.toggle })).not.toBeChecked()
    expect(screen.queryByLabelText(BACKUP_FILE_COPY.folderLabel)).toBeNull()
  })

  it('shows the fields and an example path built from the saved values', async () => {
    renderIt({ file: { ...FILE, folder: 'My Backups', pattern: 'bk {groups}' } })
    expect(await screen.findByText(/^Example: Downloads\/My Backups\/bk 4\.json$/)).toBeInTheDocument()
  })

  it.each([
    ['folder: traversal', 'folder', '../x', /./],
    ['folder: reserved name', 'folder', 'CON', /./],
    ['folder: superscript reserved', 'folder', 'COM¹', /./],
    ['folder: zero-width character', 'folder', 'a​b', /./],
    ['pattern: reserved token result', 'pattern', 'com{groups}', /./],
    ['pattern: CONIN$', 'pattern', 'CONIN$', /./],
    ['pattern: bidi override', 'pattern', 'a‮b', /./],
    ['pattern: empty', 'pattern', '', /./],
  ])('invalid %s shows an error, is not saved, and the example asks to fix the field', async (_n, field, value, message) => {
    const { onSave } = renderIt()
    await ready()
    const input = field === 'folder' ? folderInput() : patternInput()
    fireEvent.change(input, { target: { value } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(document.querySelector('.text-destructive')?.textContent).toMatch(message)
    expect(screen.getByText('Fix the highlighted field to see where files will go.')).toBeInTheDocument()
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a valid change is saved on blur, once, and an unchanged value is not saved', async () => {
    const { onSave } = renderIt()
    await ready()
    fireEvent.change(folderInput(), { target: { value: 'Other' } })
    fireEvent.blur(folderInput())
    expect(onSave).toHaveBeenCalledWith({ autoBackupFileFolder: 'Other' })
    fireEvent.change(patternInput(), { target: { value: DEFAULT_BACKUP_FILE_PATTERN } })
    fireEvent.blur(patternInput())
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('Reset puts back the default folder and pattern; it is disabled when they already are the defaults', async () => {
    const { onSave } = renderIt({ file: { ...FILE, folder: 'Other' } })
    const reset = await screen.findByRole('button', { name: 'Reset' })
    fireEvent.click(reset)
    expect(onSave).toHaveBeenCalledWith({ autoBackupFileFolder: DEFAULT_BACKUP_FILE_FOLDER, autoBackupFilePattern: DEFAULT_BACKUP_FILE_PATTERN })
  })

  it('Reset is disabled at the defaults', async () => {
    renderIt()
    expect(await screen.findByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('disabled: the switch and the fields cannot be used', async () => {
    renderIt({ disabled: true })
    await ready()
    expect(screen.getByRole('switch', { name: BACKUP_FILE_COPY.toggle })).toBeDisabled()
    expect(folderInput()).toBeDisabled()
    expect(patternInput()).toBeDisabled()
  })

  it('shows how the last file write ended', async () => {
    h.status = { at: Date.now() - 5000, result: 'no-permission', path: 'F/x.json' }
    renderIt()
    expect(await screen.findByText(/The file was not saved: TabMerger no longer has permission/)).toBeInTheDocument()
  })
})
