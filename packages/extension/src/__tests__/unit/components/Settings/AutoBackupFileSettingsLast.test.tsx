import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { BACKUP_FILE_COPY, DEFAULT_BACKUP_FILE_FOLDER, DEFAULT_BACKUP_FILE_PATTERN } from '@tabmerger/shared'
import { AutoBackupFileSettings } from '@/components/Settings/AutoBackupFileSettings'

const h = vi.hoisted(() => ({
  permitted: true,
  settings: {} as Record<string, unknown>,
  toastError: vi.fn()
}))

vi.mock('@/lib/localDb', () => ({ getSetting: async (key: string, fallback: unknown) => (key in h.settings ? h.settings[key] : fallback) }))
vi.mock('@/lib/toast', () => ({ toast: { error: (...a: unknown[]) => h.toastError(...a), success: vi.fn(), info: vi.fn() } }))

const FILE = { enabled: true, folder: DEFAULT_BACKUP_FILE_FOLDER, pattern: DEFAULT_BACKUP_FILE_PATTERN }
const PATH = 'C:\\Users\\me\\Downloads\\TabMerger\\TabMerger backup.json'
const MIN = 60_000

let search: ReturnType<typeof vi.fn>
let show: ReturnType<typeof vi.fn>
let showDefaultFolder: ReturnType<typeof vi.fn>
let changeListeners: Array<(d: { id?: unknown }) => void>
let removeListener: ReturnType<typeof vi.fn>

const item = (extra: Record<string, unknown> = {}) => ({ id: 7, filename: PATH, state: 'complete', exists: true, ...extra })

function setChrome(downloads: Record<string, unknown> | undefined) {
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: 'ext' },
    permissions: { contains: async () => h.permitted, request: vi.fn(async () => true) },
    ...(downloads ? { downloads } : {})
  }
}

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AutoBackupFileSettings file={FILE} disabled={false} onSave={vi.fn()} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  h.permitted = true
  h.settings = { autoBackupFileLast: { id: 7, at: Date.now() - 5 * MIN } }
  h.toastError.mockClear()
  search = vi.fn(async () => [item()])
  show = vi.fn()
  showDefaultFolder = vi.fn()
  changeListeners = []
  removeListener = vi.fn()
  setChrome({
    search,
    show,
    showDefaultFolder,
    onChanged: { addListener: (l: (d: { id?: unknown }) => void) => changeListeners.push(l), removeListener }
  })
})

const group = () => screen.findByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel })
const showButton = (name: string) => screen.findByRole('button', { name })

describe('AutoBackupFileSettings: finding the file', () => {
  it('says where to find the files', async () => {
    renderIt()
    expect(await screen.findByText(BACKUP_FILE_COPY.whereToFind)).toBeInTheDocument()
  })

  it('found: shows the absolute path as text, when it was saved, and "Show in folder"', async () => {
    renderIt()
    expect(await screen.findByTestId('backup-file-path')).toHaveTextContent(PATH)
    expect(await group()).toHaveTextContent(/Saved 5 mins ago/)
    expect(await showButton(BACKUP_FILE_COPY.showInFolder)).not.toHaveAttribute('aria-disabled', 'true')
    expect(search).toHaveBeenCalledWith({ id: 7 })
  })

  it('"Show in folder" shows that file (by id) and toasts nothing', async () => {
    renderIt()
    fireEvent.click(await showButton(BACKUP_FILE_COPY.showInFolder))
    await waitFor(() => expect(show).toHaveBeenCalledWith(7))
    expect(showDefaultFolder).not.toHaveBeenCalled()
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('a path with markup is rendered as text, never as elements or a link', async () => {
    search.mockResolvedValue([item({ filename: '/home/<img src=x onerror=alert(1)>/<a href="https://evil.test">x</a>.json' })])
    renderIt()
    const el = await screen.findByTestId('backup-file-path')
    expect(el).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(el.querySelector('img, a')).toBeNull()
  })

  it('a right-to-left override in the path is removed before it is shown', async () => {
    search.mockResolvedValue([item({ filename: '/home/me/backup\u202enosj.exe' })])
    renderIt()
    expect(await screen.findByTestId('backup-file-path')).toHaveTextContent(/^\/home\/me\/backupnosj\.exe$/)
  })

  it('a very long path is cut at 1024 characters', async () => {
    search.mockResolvedValue([item({ filename: `/${'a'.repeat(3000)}` })])
    renderIt()
    expect((await screen.findByTestId('backup-file-path')).textContent!.length).toBeLessThanOrEqual(1025)
  })

  it('pending: says the file is still being written', async () => {
    search.mockResolvedValue([item({ state: 'in_progress' })])
    renderIt()
    expect(await screen.findByText(BACKUP_FILE_COPY.lastFilePending)).toBeInTheDocument()
    expect(screen.queryByTestId('backup-file-path')).toBeNull()
  })

  it('gone: says it was moved or deleted, shows no path, and the button opens the Downloads folder', async () => {
    search.mockResolvedValue([item({ exists: false })])
    renderIt()
    expect(await group()).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel })).toHaveTextContent(BACKUP_FILE_COPY.lastFileGone))
    expect(screen.queryByTestId('backup-file-path')).toBeNull()
    fireEvent.click(await showButton(BACKUP_FILE_COPY.showDownloadsFolder))
    await waitFor(() => expect(showDefaultFolder).toHaveBeenCalledTimes(1))
    expect(show).not.toHaveBeenCalled()
  })

  it('a file deleted after the panel was shown opens the Downloads folder, not the missing file (asks again first)', async () => {
    renderIt()
    const btn = await showButton(BACKUP_FILE_COPY.showInFolder)
    search.mockResolvedValue([item({ exists: false })])
    fireEvent.click(btn)
    await waitFor(() => expect(showDefaultFolder).toHaveBeenCalledTimes(1))
    expect(show).not.toHaveBeenCalled()
  })

  it('nothing recorded and no status: "No file has been saved yet." and the Downloads folder button', async () => {
    h.settings = {}
    renderIt()
    expect(await screen.findByText('No file has been saved yet.')).toBeInTheDocument()
    expect(await showButton(BACKUP_FILE_COPY.showDownloadsFolder)).toBeInTheDocument()
    expect(search).not.toHaveBeenCalled()
  })

  it('nothing recorded but a status: the status line stands in for the path', async () => {
    h.settings = { autoBackupFileStatus: { at: Date.now() - 2 * MIN, result: 'saved', path: 'TabMerger/x.json' } }
    renderIt()
    expect(await screen.findByText(/Last file, 2 mins ago: .*TabMerger\/x\.json/)).toBeInTheDocument()
  })

  it('a malformed stored value is treated as nothing recorded', async () => {
    h.settings = { autoBackupFileLast: { id: -3, at: 'x' } }
    renderIt()
    expect(await screen.findByText('No file has been saved yet.')).toBeInTheDocument()
    expect(search).not.toHaveBeenCalled()
  })

  it('a download by another extension is not shown as ours', async () => {
    search.mockResolvedValue([item({ byExtensionId: 'someone-else' })])
    renderIt()
    await waitFor(() => expect(screen.getByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel })).toHaveTextContent(BACKUP_FILE_COPY.lastFileGone))
    expect(screen.queryByTestId('backup-file-path')).toBeNull()
  })

  it('the browser cannot be asked (search throws): falls back to the status line', async () => {
    search.mockRejectedValue(new Error('no'))
    h.settings = { ...h.settings, autoBackupFileStatus: { at: Date.now() - MIN, result: 'saved', path: 'TabMerger/x.json' } }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderIt()
    expect(await screen.findByText(/Last file, 1 min ago/)).toBeInTheDocument()
    expect(screen.queryByTestId('backup-file-path')).toBeNull()
  })

  it('amber "Last attempt" line when a newer write failed; the last file shown is the one before', async () => {
    h.settings = { ...h.settings, autoBackupFileStatus: { at: Date.now() - MIN, result: 'failed', path: 'TabMerger/x.json' } }
    renderIt()
    expect(await screen.findByTestId('backup-file-path')).toHaveTextContent(PATH)
    const attempt = await screen.findByText(/^Last attempt, 1 min ago:/)
    expect(attempt).toHaveClass('text-amber-500')
  })

  it('no "Last attempt" line when the newest write succeeded', async () => {
    h.settings = { ...h.settings, autoBackupFileStatus: { at: Date.now() - MIN, result: 'saved', path: 'TabMerger/x.json' } }
    renderIt()
    await screen.findByTestId('backup-file-path')
    expect(screen.queryByText(/^Last attempt/)).toBeNull()
  })

  it('re-reads when the popup gets focus back (the user may have moved the file)', async () => {
    renderIt()
    await screen.findByTestId('backup-file-path')
    const calls = search.mock.calls.length
    search.mockResolvedValue([item({ exists: false })])
    focusManager.setFocused(false); focusManager.setFocused(true)
    await waitFor(() => expect(screen.getByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel })).toHaveTextContent(BACKUP_FILE_COPY.lastFileGone))
    expect(search.mock.calls.length).toBeGreaterThan(calls)
  })

  it('re-reads on downloads.onChanged for that id only, and stops listening on unmount', async () => {
    const { unmount } = renderIt()
    await screen.findByTestId('backup-file-path')
    await waitFor(() => expect(changeListeners.length).toBeGreaterThan(0))
    const calls = search.mock.calls.length
    changeListeners.forEach((l) => l({ id: 999 }))
    await new Promise((r) => setTimeout(r, 30))
    expect(search.mock.calls.length).toBe(calls)

    search.mockResolvedValue([item({ exists: false })])
    changeListeners.forEach((l) => l({ id: 7 }))
    await waitFor(() => expect(screen.getByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel })).toHaveTextContent(BACKUP_FILE_COPY.lastFileGone))

    unmount()
    expect(removeListener).toHaveBeenCalled()
  })

  describe('when the browser cannot open a folder', () => {
    beforeEach(() => setChrome({ search }))

    it('the button is aria-disabled with the reason attached, and pressing it does nothing', async () => {
      renderIt()
      const btn = await showButton(BACKUP_FILE_COPY.showInFolder)
      expect(btn).toHaveAttribute('aria-disabled', 'true')
      expect(btn).toHaveAccessibleDescription(BACKUP_FILE_COPY.showUnavailable)
      fireEvent.click(btn)
      await new Promise((r) => setTimeout(r, 30))
      expect(h.toastError).not.toHaveBeenCalled()
    })
  })

  describe('failures of the open call', () => {
    it('Firefox: show resolving false opens the Downloads folder instead', async () => {
      show.mockResolvedValue(false)
      renderIt()
      fireEvent.click(await showButton(BACKUP_FILE_COPY.showInFolder))
      await waitFor(() => expect(showDefaultFolder).toHaveBeenCalledTimes(1))
      expect(h.toastError).not.toHaveBeenCalled()
    })

    it('an API that throws toasts the failure copy', async () => {
      show.mockRejectedValue(new Error('no'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      renderIt()
      fireEvent.click(await showButton(BACKUP_FILE_COPY.showInFolder))
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(BACKUP_FILE_COPY.showFailed))
    })

    it('the permission gone between render and click toasts the unavailable copy', async () => {
      renderIt()
      const btn = await showButton(BACKUP_FILE_COPY.showInFolder)
      h.permitted = false
      fireEvent.click(btn)
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(BACKUP_FILE_COPY.showUnavailable))
    })
  })

  it('the Last file block is hidden while the option is off', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AutoBackupFileSettings file={{ ...FILE, enabled: false }} disabled={false} onSave={vi.fn()} />
      </QueryClientProvider>
    )
    await screen.findByRole('switch', { name: BACKUP_FILE_COPY.toggle })
    expect(screen.queryByRole('group', { name: BACKUP_FILE_COPY.lastFileLabel })).toBeNull()
    expect(search).not.toHaveBeenCalled()
  })
})
