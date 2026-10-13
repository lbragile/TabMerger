import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_BACKUP_FILE_FOLDER } from '@tabmerger/shared'
import type { Group } from '@/lib/types'
import { backupFileContent, hasBackupFilePermission, isBackupFileResult, parseBackupFileStatus, saveBackupFile } from '@/lib/autoBackupFile'

const CREATED = Date.UTC(2030, 5, 15, 9, 5, 7)
const group = (id: string, urls: string[], extra: Record<string, unknown> = {}): Group =>
  ({
    id,
    name: `G ${id}`,
    color: 'rgba(1, 2, 3, 1)',
    updatedAt: 1,
    windows: [{ id: 1, incognito: false, focused: false, tabs: urls.map((url) => ({ id: 0, title: 't', url })) }],
    ...extra,
  }) as Group

let download: ReturnType<typeof vi.fn>
let contains: ReturnType<typeof vi.fn>
const setChrome = (c: unknown) => ((globalThis as { chrome?: unknown }).chrome = c)

beforeEach(() => {
  download = vi.fn(async () => 7)
  contains = vi.fn(async () => true)
  setChrome({ permissions: { contains }, downloads: { download } })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('isBackupFileResult / parseBackupFileStatus', () => {
  it('accepts only the three results', () => {
    for (const r of ['saved', 'no-permission', 'failed']) expect(isBackupFileResult(r)).toBe(true)
    for (const r of ['ok', '', null, 5, 'toString']) expect(isBackupFileResult(r)).toBe(false)
  })
  it('parses a well-formed status and cuts a long path', () => {
    expect(parseBackupFileStatus({ at: 5, result: 'saved', path: 'a/b.json' })).toEqual({ at: 5, result: 'saved', path: 'a/b.json' })
    expect(parseBackupFileStatus({ at: 5, result: 'saved', path: 'x'.repeat(500) })!.path).toHaveLength(300)
  })
  it.each([[null], ['x'], [{}], [{ at: NaN, result: 'saved', path: 'p' }], [{ at: 1, result: 'bad', path: 'p' }], [{ at: 1, result: 'saved', path: 4 }]])('rejects %j', (v) => {
    expect(parseBackupFileStatus(v)).toBeNull()
  })
})

describe('hasBackupFilePermission', () => {
  it('asks for exactly the downloads permission', async () => {
    expect(await hasBackupFilePermission()).toBe(true)
    expect(contains).toHaveBeenCalledWith({ permissions: ['downloads'] })
  })
  it('is false when the API is missing, the answer is false, or it throws', async () => {
    setChrome({})
    expect(await hasBackupFilePermission()).toBe(false)
    setChrome({ permissions: { contains: async () => false } })
    expect(await hasBackupFilePermission()).toBe(false)
    setChrome({
      permissions: {
        contains: async () => {
          throw new Error('x')
        },
      },
    })
    expect(await hasBackupFilePermission()).toBe(false)
    delete (globalThis as { chrome?: unknown }).chrome
    expect(await hasBackupFilePermission()).toBe(false)
  })
})

describe('backupFileContent', () => {
  it('is the Export format: a JSON array of the saved groups, never Now Open', () => {
    const parsed = JSON.parse(backupFileContent([group('now', ['https://n.com'], { permanent: true }), group('a', ['https://a.com'])]))
    expect(parsed.map((g: { id: string }) => g.id)).toEqual(['a'])
  })
  it('strips the local-only sync keys at EVERY level, not only on the group', () => {
    const g = group('a', ['https://a.com'], { pendingSync: true, positionDirty: true, remoteUpdatedAt: 5 })
    ;(g.windows[0] as unknown as Record<string, unknown>).pendingSync = true
    ;(g.windows[0].tabs[0] as unknown as Record<string, unknown>).remoteUpdatedAt = 9
    const text = backupFileContent([g])
    for (const k of ['pendingSync', 'positionDirty', 'remoteUpdatedAt']) expect(text).not.toContain(k)
    expect(JSON.parse(text)[0].windows[0].tabs[0].url).toBe('https://a.com')
  })
})

describe('saveBackupFile', () => {
  const session = { groups: [group('now', ['https://n.com'], { permanent: true }), group('a', ['https://a.com', 'https://b.com']), group('b', ['https://c.com'])], createdAt: CREATED }

  it('renders the name from the pattern: group and tab counts (Now Open not counted), inside the folder', async () => {
    const out = await saveBackupFile(session, 'My Backups', 'bk {groups}g {tabs}t')
    expect(out).toEqual({ result: 'saved', path: 'My Backups/bk 2g 3t.json' })
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ filename: 'My Backups/bk 2g 3t.json', saveAs: false, conflictAction: 'uniquify' }))
  })

  it('renders date and time tokens', async () => {
    const out = await saveBackupFile(session, 'F', '{date} {time}')
    expect(out.path).toMatch(/^F\/2030-06-15 \d{2}[-.]\d{2}[-.]\d{2}\.json$/)
  })

  it('uses the defaults for an invalid stored folder and pattern, and the path stays inside Downloads', async () => {
    const out = await saveBackupFile(session, '../../etc', '')
    expect(out.path.startsWith(`${DEFAULT_BACKUP_FILE_FOLDER}/`)).toBe(true)
    expect(out.path).not.toContain('..')
  })

  it('passes the file text as a data: URL when the worker has no createObjectURL (service worker)', async () => {
    const original = URL.createObjectURL
    ;(URL as unknown as { createObjectURL?: unknown }).createObjectURL = undefined
    try {
      await saveBackupFile(session, 'F', 'x')
      const { url } = download.mock.calls[0][0] as { url: string }
      expect(url.startsWith('data:application/json;charset=utf-8;base64,')).toBe(true)
      const bytes = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0))
      expect(JSON.parse(new TextDecoder().decode(bytes))).toHaveLength(2)
    } finally {
      URL.createObjectURL = original
    }
  })

  it('uses a blob URL (released after a minute) where createObjectURL exists (Firefox background page)', async () => {
    vi.useFakeTimers()
    const original = { c: URL.createObjectURL, r: URL.revokeObjectURL }
    try {
      const revoke = vi.fn()
      URL.createObjectURL = vi.fn(() => 'blob:abc') as never
      URL.revokeObjectURL = revoke as never
      await saveBackupFile(session, 'F', 'x')
      expect(download).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:abc' }))
      expect(revoke).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(revoke).toHaveBeenCalledWith('blob:abc')
    } finally {
      URL.createObjectURL = original.c
      URL.revokeObjectURL = original.r
      vi.useRealTimers()
    }
  })

  it('permission missing: no download, result no-permission, the intended path is still reported', async () => {
    contains.mockResolvedValue(false)
    expect(await saveBackupFile(session, 'F', 'x')).toEqual({ result: 'no-permission', path: 'F/x.json' })
    expect(download).not.toHaveBeenCalled()
  })

  it('chrome.downloads missing: no-permission, nothing thrown', async () => {
    setChrome({ permissions: { contains } })
    expect((await saveBackupFile(session, 'F', 'x')).result).toBe('no-permission')
  })

  it('a download that throws or does not return an id is failed, never an exception', async () => {
    download.mockRejectedValueOnce(new Error('blocked'))
    expect((await saveBackupFile(session, 'F', 'x')).result).toBe('failed')
    download.mockResolvedValueOnce(undefined)
    expect((await saveBackupFile(session, 'F', 'x')).result).toBe('failed')
  })

  it('never deletes anything: only chrome.downloads.download is used', async () => {
    const erase = vi.fn()
    const removeFile = vi.fn()
    setChrome({ permissions: { contains }, downloads: { download, erase, removeFile } })
    await saveBackupFile(session, 'F', 'x')
    await saveBackupFile({ ...session, createdAt: CREATED + 1 }, 'F', 'y')
    expect(erase).not.toHaveBeenCalled()
    expect(removeFile).not.toHaveBeenCalled()
  })
})
