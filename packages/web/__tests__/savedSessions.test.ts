import { describe, it, expect } from 'vitest'
import { AUTO_BACKUP_DOWNLOAD_LIMITS, DEFAULT_BACKUP_FILE_PATTERN, GROUP_COLOR_RE, buildBackupFilePath } from '@tabmerger/shared'
import {
  LOCAL_ONLY_SYNC_KEYS,
  backupFileContent,
  backupFileName,
  countTabs,
  countWindows,
  formatAbsoluteTime,
  formatRelativeTime,
  lockedSavedItem,
  readSavedGroups,
  splitSavedItems,
  toSavedItem,
} from '@/lib/savedSessions'

const ROW = { id: 'r1', created_at: '2030-01-02T10:00:00.000Z' }
const tab = (url: string, title = 't') => ({ url, title })
const group = (name: string, tabs: unknown[]) => ({ name, windows: [{ tabs }] })

describe('toSavedItem: which rows are automatic backups', () => {
  it.each([
    [true, true],
    [false, false],
    ['true', false],
    [1, false],
    [undefined, false],
  ])('auto: %j gives auto === %j', (auto, expected) => {
    expect(toSavedItem(ROW, { name: 'n', groups: [], auto }).auto).toBe(expected)
  })

  it('keeps the row id and time, not anything the content says about them', () => {
    const item = toSavedItem(ROW, { id: 'other', created_at: 'x', name: 'n', groups: [] })
    expect(item.id).toBe('r1')
    expect(item.created_at).toBe(ROW.created_at)
  })
})

describe('toSavedItem: content that is not what the extension writes', () => {
  it.each([[null], ['text'], [42], [[1, 2]], [undefined]])('content %j is damaged with no kind', (content) => {
    const item = toSavedItem(ROW, content)
    expect(item).toMatchObject({ damaged: true, groups: [], exportable: [] })
    expect(item.auto).toBeUndefined()
  })

  it.each([['x'], [null], [{ 0: 'a' }], [undefined]])('groups %j is damaged but keeps the auto marker', (groups) => {
    expect(toSavedItem(ROW, { name: 'n', auto: true, groups })).toMatchObject({ damaged: true, auto: true, groups: [] })
  })

  it('rejects more groups than a backup may hold', () => {
    const groups = Array.from({ length: AUTO_BACKUP_DOWNLOAD_LIMITS.groupsPerBackup + 1 }, () => ({ windows: [] }))
    expect(readSavedGroups(groups)).toBeNull()
    expect(toSavedItem(ROW, { groups, auto: true }).damaged).toBe(true)
  })

  it('leaves out entries that are not groups, windows or tabs, and non-string fields', () => {
    const item = toSavedItem(ROW, {
      name: 7,
      description: {},
      groups: [
        null,
        'group',
        { name: 5, color: 9, windows: 'nope' },
        { name: 'Kept', windows: [null, { tabs: 'x' }, { tabs: [null, { url: 5 }, { title: 'no url' }, { url: 'https://ok.example', title: { a: 1 } }] }] },
      ],
    })
    expect(item.damaged).toBeUndefined()
    expect(item.name).toBe('')
    expect(item.description).toBeUndefined()
    expect(item.groups).toEqual([{ windows: [] }, { name: 'Kept', windows: [{ tabs: [{ url: 'https://ok.example', title: '' }] }] }])
    expect(countTabs(item.groups)).toBe(1)
    expect(countWindows(item.groups)).toBe(1)
  })

  it('only keeps a colour written as rgb()/rgba() or hex', () => {
    const colours = ['rgba(1, 2, 3, 0.5)', '#abc', 'url(https://tracker.example/x.png)', 'red; background: url(x)', 'var(--x)']
    const item = toSavedItem(ROW, { groups: colours.map((color) => ({ color, windows: [] })) })
    expect(item.groups.map((g) => g.color)).toEqual(['rgba(1, 2, 3, 0.5)', '#abc', undefined, undefined, undefined])
    // The rule is the shared one, the same the extension's importer applies.
    expect(item.groups.map((g) => g.color !== undefined)).toEqual(colours.map((c) => GROUP_COLOR_RE.test(c)))
  })

  it('cuts over-long text, drops over-long addresses and bounds the counts', () => {
    const L = AUTO_BACKUP_DOWNLOAD_LIMITS
    const item = toSavedItem(ROW, {
      name: 'n'.repeat(L.nameLength + 10),
      groups: [
        {
          name: 'g'.repeat(L.nameLength + 10),
          windows: [
            { tabs: [tab('https://a.example/' + 'x'.repeat(L.urlLength)), tab('https://b.example', 't'.repeat(L.titleLength + 5))] },
            ...Array.from({ length: L.windowsPerGroup + 3 }, () => ({ tabs: [] })),
          ],
        },
        { windows: [{ tabs: Array.from({ length: L.tabsPerWindow + 7 }, (_, i) => tab(`https://t.example/${i}`)) }] },
      ],
    })
    expect(item.name).toHaveLength(L.nameLength)
    expect(item.groups[0].name).toHaveLength(L.nameLength)
    expect(item.groups[0].windows).toHaveLength(L.windowsPerGroup)
    expect(item.groups[0].windows[0].tabs).toEqual([{ url: 'https://b.example', title: 't'.repeat(L.titleLength) }])
    expect(item.groups[1].windows[0].tabs).toHaveLength(L.tabsPerWindow)
  })

  it('shows a custom title in place of the page title', () => {
    const item = toSavedItem(ROW, { groups: [group('G', [{ url: 'https://a.example', title: 'Page', customTitle: 'Mine' }])] })
    expect(item.groups[0].windows[0].tabs[0].title).toBe('Mine')
  })
})

describe('splitSavedItems', () => {
  const at = (id: string, created_at: string, content: unknown) => toSavedItem({ id, created_at }, content)

  it('puts only known backups under backups, newest first, and never loses a row', () => {
    const items = [
      at('old', '2030-01-01T00:00:00Z', { groups: [], auto: true }),
      at('manual', '2030-01-05T00:00:00Z', { groups: [] }),
      lockedSavedItem({ id: 'locked', created_at: '2030-01-04T00:00:00Z' }),
      at('new', '2030-01-03T00:00:00Z', { groups: [], auto: true }),
      at('garbage', '2030-01-02T00:00:00Z', 'not an object'),
      at('nodate', 'whenever', { groups: [], auto: true }),
      at('damaged-backup', '2030-01-02T12:00:00Z', { groups: 5, auto: true }),
      at('damaged-session', '2030-01-02T12:00:00Z', { groups: 5 }),
    ]
    const { sessions, backups, unknownKind } = splitSavedItems(items)
    expect(backups.map((b) => b.id)).toEqual(['new', 'damaged-backup', 'old', 'nodate'])
    expect(sessions.map((s) => s.id)).toEqual(['manual', 'locked', 'garbage', 'damaged-session'])
    // locked + content that is not an object; a damaged session without a marker is a session.
    expect(unknownKind).toBe(2)
    expect(sessions.length + backups.length).toBe(items.length)
  })
})

describe('backup file', () => {
  it('is a JSON array of the stored group entries, with every stored field', () => {
    const stored = [
      { id: 'g1', name: 'Work', color: 'rgba(1, 2, 3, 1)', updatedAt: 5, starred: true, note: 'n', windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, url: 'https://a.example', title: 'A', pinned: true, favIconUrl: 'https://a.example/i.png' }] }] },
    ]
    const item = toSavedItem(ROW, { name: 'b', auto: true, groups: [...stored, 'not a group', null] })
    expect(JSON.parse(backupFileContent(item))).toEqual(stored)
  })

  describe("a device's sync bookkeeping", () => {
    // What the extension's importer (`importGroups`) reads from a file, per level.
    const fileTab = { id: 0, url: 'https://a.example', title: 'A', customTitle: 'Mine', favIconUrl: 'https://a.example/i.png', ogImage: 'https://a.example/o.png', pinned: true, note: 'tab note', savedAt: 1700000000000, chromeGroup: { id: 3, name: 'cg', color: 'blue' }, reminder: { fireAt: 1800000000000, note: 'r' } }
    const fileWindow = { id: 0, incognito: true, focused: false, starred: true, name: 'Win', note: 'window note', tabs: [fileTab] }
    const fileGroup = { id: 'g1', name: 'Work', color: 'rgba(1, 2, 3, 1)', updatedAt: 5, permanent: false, starred: true, archived: true, note: 'group note', info: '1T | 1W', windows: [fileWindow] }
    const BOOKKEEPING = { pendingSync: true, positionDirty: true, remoteUpdatedAt: '2030-01-01T00:00:00.000Z' }

    const stored = [
      {
        ...fileGroup,
        ...BOOKKEEPING,
        windows: [{ ...fileWindow, ...BOOKKEEPING, tabs: [{ ...fileTab, ...BOOKKEEPING, chromeGroup: { ...fileTab.chromeGroup, ...BOOKKEEPING } }] }],
      },
      { id: 'g2', name: 'Falsy values', windows: [], pendingSync: false, positionDirty: false, remoteUpdatedAt: null },
    ]

    it("is the same three keys the extension leaves out of its own files", () => {
      expect([...LOCAL_ONLY_SYNC_KEYS].sort()).toEqual(['pendingSync', 'positionDirty', 'remoteUpdatedAt'])
    })

    it('is in the file at no level: group, window, tab or below', () => {
      const text = backupFileContent(toSavedItem(ROW, { name: 'b', auto: true, groups: stored }))
      for (const key of LOCAL_ONLY_SYNC_KEYS) expect(text).not.toContain(key)
    })

    it('leaves every field the import reads exactly as it was stored', () => {
      const text = backupFileContent(toSavedItem(ROW, { name: 'b', auto: true, groups: stored }))
      expect(JSON.parse(text)).toEqual([fileGroup, { id: 'g2', name: 'Falsy values', windows: [] }])
    })

    it('does not change the item it was given (the page still shows it)', () => {
      const item = toSavedItem(ROW, { name: 'b', auto: true, groups: stored })
      const before = JSON.stringify(item.exportable)
      backupFileContent(item)
      expect(JSON.stringify(item.exportable)).toBe(before)
      expect(before).toContain('pendingSync')
    })

    it('still writes a JSON array when there is nothing to export', () => {
      expect(backupFileContent({ exportable: [] })).toBe('[]')
    })

    it('copes with content nested far deeper than the extension writes', () => {
      let deep: Record<string, unknown> = { pendingSync: true }
      for (let i = 0; i < 5000; i++) deep = { child: deep }
      const text = backupFileContent({ exportable: [{ id: 'g', name: 'Deep', windows: [], extra: deep }] })
      expect(text).not.toContain('pendingSync')
      expect(JSON.parse(text)[0]).toMatchObject({ id: 'g', name: 'Deep', windows: [] })
    })
  })

  it("uses the extension's default file name, in local time, from the row's created_at", () => {
    const d = new Date(2026, 9, 12, 14, 5, 9)
    expect(backupFileName({ created_at: d.toISOString(), groups: [] })).toBe('TabMerger backup 2026-10-12 14-05-09.json')
    // The shared builder and pattern produce it: no folder, nothing re-implemented here.
    expect(backupFileName({ created_at: d.toISOString(), groups: [] })).toBe(
      buildBackupFilePath('', DEFAULT_BACKUP_FILE_PATTERN, { createdAt: d.getTime(), groups: 0, tabs: 0 })
    )
    expect(backupFileName({ created_at: d.toISOString(), groups: [] })).not.toMatch(/[\/]/)
  })

  it('has no date in the name when the row has no usable date (never 1970)', () => {
    expect(backupFileName({ created_at: 'nope', groups: [] })).toBe('TabMerger backup.json')
  })
})

describe('time formatting', () => {
  const now = Date.UTC(2030, 0, 10, 12, 0)
  const H = 60 * 60 * 1000

  it.each([
    [now - 30 * 1000, 'now'],
    [now - 5 * 60 * 1000, '5 minutes ago'],
    [now - 3 * H, '3 hours ago'],
    [now - 24 * H, 'yesterday'],
    [now - 6 * 24 * H, '6 days ago'],
    [now - 60 * 24 * H, '2 months ago'],
    [now - 800 * 24 * H, '2 years ago'],
    [now + 2 * H, 'in 2 hours'],
  ])('%d reads "%s"', (ms, text) => {
    expect(formatRelativeTime(ms, now, 'en-US')).toBe(text)
  })

  it('writes the date and time in the given locale', () => {
    const ms = new Date(2030, 9, 11, 14, 0).getTime()
    expect(formatAbsoluteTime(ms, 'en-US')).toMatch(/^October 11, 2030 at 2:00\sPM$/)
    expect(formatAbsoluteTime(ms, 'de-DE')).toMatch(/^11\. Oktober 2030 um 14:00$/)
  })
})
