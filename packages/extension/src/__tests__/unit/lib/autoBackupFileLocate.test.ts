import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Group } from '@/lib/types'
import { canShowBackupFolder, locateBackupFile, parseBackupFileLast, saveBackupFile, showBackupFile } from '@/lib/autoBackupFile'

const setChrome = (c: unknown) => ((globalThis as { chrome?: unknown }).chrome = c)
let contains: ReturnType<typeof vi.fn>
let download: ReturnType<typeof vi.fn>

beforeEach(() => {
  contains = vi.fn(async () => true)
  download = vi.fn(async () => 7)
  setChrome({ permissions: { contains }, downloads: { download } })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('saveBackupFile downloadId', () => {
  const session = {
    groups: [{ id: 'a', name: 'A', color: 'rgba(1, 2, 3, 1)', updatedAt: 1, windows: [] } as unknown as Group],
    createdAt: Date.UTC(2030, 5, 15)
  }
  it('returns the browser id of the download (0 is a valid id)', async () => {
    download.mockResolvedValueOnce(0)
    expect(await saveBackupFile(session, 'F', 'x')).toEqual({ result: 'saved', path: 'F/x.json', downloadId: 0 })
  })
  it('has no downloadId when nothing was saved', async () => {
    download.mockRejectedValueOnce(new Error('blocked'))
    expect(await saveBackupFile(session, 'F', 'x')).not.toHaveProperty('downloadId')
    contains.mockResolvedValue(false)
    expect(await saveBackupFile(session, 'F', 'x')).not.toHaveProperty('downloadId')
  })
})

describe('parseBackupFileLast', () => {
  it('accepts a well-formed value, including id 0', () => {
    expect(parseBackupFileLast({ id: 12, at: 1000 })).toEqual({ id: 12, at: 1000 })
    expect(parseBackupFileLast({ id: 0, at: 1 })).toEqual({ id: 0, at: 1 })
  })
  it('keeps only id and at', () => {
    expect(parseBackupFileLast({ id: 1, at: 2, path: '/etc/passwd' })).toEqual({ id: 1, at: 2 })
  })
  it.each([
    [null],
    [undefined],
    ['x'],
    [5],
    [{}],
    [{ id: -1, at: 1 }],
    [{ id: 1.5, at: 1 }],
    [{ id: '3', at: 1 }],
    [{ id: NaN, at: 1 }],
    [{ id: Infinity, at: 1 }],
    [{ id: Number.MAX_SAFE_INTEGER + 2, at: 1 }],
    [{ id: 3 }],
    [{ id: 3, at: '1' }],
    [{ id: 3, at: NaN }],
    [{ id: 3, at: Infinity }]
  ])('rejects %j', (v) => {
    expect(parseBackupFileLast(v)).toBeNull()
  })
})

describe('locateBackupFile', () => {
  const LAST = { id: 7, at: 5000 }
  const PATH = 'C:\\Users\\me\\Downloads\\TabMerger\\b.json'
  let search: ReturnType<typeof vi.fn>
  const item = (extra: Record<string, unknown> = {}) => ({ id: 7, filename: PATH, state: 'complete', exists: true, ...extra })
  beforeEach(() => {
    search = vi.fn(async () => [item()])
    setChrome({ runtime: { id: 'me-ext' }, permissions: { contains }, downloads: { download, search } })
  })

  it('none: nothing recorded, the browser is not asked', async () => {
    expect(await locateBackupFile(null)).toEqual({ kind: 'none' })
    expect(search).not.toHaveBeenCalled()
  })
  it('found: the absolute path, asked by id only', async () => {
    expect(await locateBackupFile(LAST)).toEqual({ kind: 'found', id: 7, at: 5000, path: PATH })
    expect(search).toHaveBeenCalledWith({ id: 7 })
  })
  it('found when exists is not reported yet and the download is by this extension', async () => {
    search.mockResolvedValue([item({ exists: undefined, byExtensionId: 'me-ext' })])
    expect((await locateBackupFile(LAST)).kind).toBe('found')
  })
  it('unavailable: permission missing, or the API has no search', async () => {
    contains.mockResolvedValue(false)
    expect(await locateBackupFile(LAST)).toEqual({ kind: 'unavailable', at: 5000 })
    contains.mockResolvedValue(true)
    setChrome({ runtime: { id: 'me-ext' }, permissions: { contains }, downloads: { download } })
    expect(await locateBackupFile(LAST)).toEqual({ kind: 'unavailable', at: 5000 })
    expect(search).not.toHaveBeenCalled()
  })
  it('unavailable (and a warning, no throw) when the API throws', async () => {
    search.mockRejectedValue(new Error('boom'))
    expect(await locateBackupFile(LAST)).toEqual({ kind: 'unavailable', at: 5000 })
    expect(console.warn).toHaveBeenCalled()
  })
  it('pending while the download is in progress', async () => {
    search.mockResolvedValue([item({ state: 'in_progress' })])
    expect(await locateBackupFile(LAST)).toEqual({ kind: 'pending', id: 7, at: 5000 })
  })
  it('gone: the browser no longer lists the download (empty, missing item, not an array, other id)', async () => {
    for (const answer of [[], undefined, null, 'x', [{ id: 99, filename: '/x' }], [null]]) {
      search.mockResolvedValue(answer)
      expect(await locateBackupFile(LAST)).toEqual({ kind: 'gone', at: 5000 })
    }
  })
  it('gone: exists is false, with no path given', async () => {
    search.mockResolvedValue([item({ exists: false })])
    const out = await locateBackupFile(LAST)
    expect(out).toEqual({ kind: 'gone', at: 5000 })
    expect(out).not.toHaveProperty('path')
  })
  it('gone: the write was interrupted', async () => {
    search.mockResolvedValue([item({ state: 'interrupted' })])
    expect((await locateBackupFile(LAST)).kind).toBe('gone')
  })
  it('gone: the download belongs to another extension (an id is not proof it is ours)', async () => {
    search.mockResolvedValue([item({ byExtensionId: 'someone-else' })])
    expect((await locateBackupFile(LAST)).kind).toBe('gone')
  })
  it('gone: an empty or non-string filename, or one that is only invisible characters', async () => {
    for (const filename of ['', undefined, 5, '\u0000\u202e']) {
      search.mockResolvedValue([item({ filename })])
      expect((await locateBackupFile(LAST)).kind).toBe('gone')
    }
  })
  it('the path is cleaned for display (text-direction characters removed)', async () => {
    search.mockResolvedValue([item({ filename: '/home/me/backup\u202enosj.exe' })])
    expect(await locateBackupFile(LAST)).toMatchObject({ kind: 'found', path: '/home/me/backupnosj.exe' })
  })
})

describe('canShowBackupFolder', () => {
  it('needs chrome.downloads with show or showDefaultFolder', () => {
    delete (globalThis as { chrome?: unknown }).chrome
    expect(canShowBackupFolder()).toBe(false)
    setChrome({})
    expect(canShowBackupFolder()).toBe(false)
    setChrome({ downloads: {} })
    expect(canShowBackupFolder()).toBe(false)
    setChrome({ downloads: { show: vi.fn() } })
    expect(canShowBackupFolder()).toBe(true)
    setChrome({ downloads: { showDefaultFolder: vi.fn() } })
    expect(canShowBackupFolder()).toBe(true)
  })
})

describe('showBackupFile', () => {
  let show: ReturnType<typeof vi.fn>
  let showDefaultFolder: ReturnType<typeof vi.fn>
  beforeEach(() => {
    show = vi.fn()
    showDefaultFolder = vi.fn()
    setChrome({ permissions: { contains }, downloads: { download, show, showDefaultFolder } })
  })

  it('shows the file when there is an id (Chrome resolves nothing)', async () => {
    expect(await showBackupFile(7)).toBe('file')
    expect(show).toHaveBeenCalledWith(7)
    expect(showDefaultFolder).not.toHaveBeenCalled()
  })
  it('id 0 is a real id', async () => {
    expect(await showBackupFile(0)).toBe('file')
    expect(show).toHaveBeenCalledWith(0)
  })
  it('opens the Downloads folder for null', async () => {
    expect(await showBackupFile(null)).toBe('folder')
    expect(show).not.toHaveBeenCalled()
    expect(showDefaultFolder).toHaveBeenCalledTimes(1)
  })
  it('Firefox: show resolving false falls back to the Downloads folder', async () => {
    show.mockResolvedValue(false)
    expect(await showBackupFile(7)).toBe('folder')
    expect(showDefaultFolder).toHaveBeenCalledTimes(1)
  })
  it('Firefox: show resolving true is the file', async () => {
    show.mockResolvedValue(true)
    expect(await showBackupFile(7)).toBe('file')
  })
  it('without show an id falls back to the folder; with only show and no id it is unavailable', async () => {
    setChrome({ permissions: { contains }, downloads: { showDefaultFolder } })
    expect(await showBackupFile(7)).toBe('folder')
    setChrome({ permissions: { contains }, downloads: { show } })
    expect(await showBackupFile(null)).toBe('unavailable')
    expect(await showBackupFile(7)).toBe('file')
  })
  it('unavailable without the permission, or when the API cannot show anything', async () => {
    contains.mockResolvedValue(false)
    expect(await showBackupFile(7)).toBe('unavailable')
    expect(show).not.toHaveBeenCalled()
    contains.mockResolvedValue(true)
    setChrome({ permissions: { contains }, downloads: { download } })
    expect(await showBackupFile(7)).toBe('unavailable')
  })
  it('failed (and a warning) when the API throws', async () => {
    show.mockRejectedValue(new Error('no'))
    expect(await showBackupFile(7)).toBe('failed')
    showDefaultFolder.mockRejectedValue(new Error('no'))
    expect(await showBackupFile(null)).toBe('failed')
    expect(console.warn).toHaveBeenCalled()
  })
})
