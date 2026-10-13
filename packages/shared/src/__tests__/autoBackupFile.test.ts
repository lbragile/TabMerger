import { describe, it, expect } from 'vitest'
import {
  BACKUP_FILE_LIMITS,
  DEFAULT_BACKUP_FILE_FOLDER,
  DEFAULT_BACKUP_FILE_PATTERN,
  backupSegmentProblem,
  buildBackupFilePath,
  normalizeBackupFilePattern,
  normalizeBackupFolder,
  validateBackupFilePattern,
  validateBackupFolder,
} from '../constants/autoBackupFile'

const ok = (value: string) => ({ ok: true, value })
const ctx = { createdAt: new Date(2026, 9, 12, 14, 5, 9).getTime(), groups: 3, tabs: 42 }

describe('validateBackupFolder', () => {
  it.each([
    ['TabMerger', 'TabMerger'],
    ['Backups/TabMerger', 'Backups/TabMerger'],
    ['Backups\\TabMerger', 'Backups/TabMerger'],
    ['TabMerger/', 'TabMerger'],
    ['My Tabs 2026', 'My Tabs 2026'],
    ['a/b/c/d/e', 'a/b/c/d/e'],
    ['', ''],
    ['   ', ''],
  ])('accepts %j as %j', (input, value) => {
    expect(validateBackupFolder(input)).toEqual(ok(value))
  })

  it.each([
    ['a parent folder', '..'],
    ['a parent folder inside', 'TabMerger/../..'],
    ['a parent folder with backslashes', '..\\..\\Windows'],
    ['the current folder', './TabMerger'],
    ['an absolute path', '/etc'],
    ['an absolute Windows path', '\\Windows\\System32'],
    ['a drive letter', 'C:\\Users\\me'],
    ['a drive letter with a slash', 'c:/x'],
    ['a bare drive letter', 'D:'],
    ['a home path', '~/backups'],
    ['an empty segment', 'a//b'],
    ['a leading space', ' TabMerger'],
    ['a trailing space', 'TabMerger '],
    ['a trailing space in a segment', 'a /b'],
    ['a leading dot', '.hidden'],
    ['a trailing dot', 'TabMerger.'],
    ['a colon', 'a:b'],
    ['an alternate data stream', 'TabMerger:stream'],
    ['a less-than sign', 'a<b'],
    ['a greater-than sign', 'a>b'],
    ['a quote', 'a"b'],
    ['a pipe', 'a|b'],
    ['a question mark', 'a?b'],
    ['an asterisk', 'a*b'],
    ['a NUL byte', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['a tab character', 'a\tb'],
    ['a DEL character', 'a\u007fb'],
    ['CON', 'CON'],
    ['con in lower case', 'con'],
    ['PRN', 'PRN'],
    ['AUX', 'aux'],
    ['NUL', 'NUL'],
    ['COM1', 'COM1'],
    ['COM9', 'com9'],
    ['LPT1', 'LPT1'],
    ['LPT9', 'lpt9'],
    ['a reserved name with an extension', 'NUL.txt'],
    ['a reserved name as a later segment', 'TabMerger/CON'],
    ['too many levels', 'a/b/c/d/e/f'],
    ['an overlong segment', 'x'.repeat(BACKUP_FILE_LIMITS.segmentLength + 1)],
  ])('rejects %s', (_name, input) => {
    const result = validateBackupFolder(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toBe('')
  })

  it.each([undefined, null, 5, {}, ['TabMerger']])('rejects a non-string (%j)', (input) => {
    expect(validateBackupFolder(input).ok).toBe(false)
  })

  it('does not reserve names that only start like a device name', () => {
    expect(validateBackupFolder('CONSOLE')).toEqual(ok('CONSOLE'))
    expect(validateBackupFolder('COM10')).toEqual(ok('COM10'))
    expect(validateBackupFolder('nulls')).toEqual(ok('nulls'))
  })
})

describe('validateBackupFilePattern', () => {
  it.each([
    [DEFAULT_BACKUP_FILE_PATTERN, DEFAULT_BACKUP_FILE_PATTERN],
    ['backup', 'backup'],
    ['  backup {date}  ', 'backup {date}'],
    ['{date} {time} {groups} groups {tabs} tabs', '{date} {time} {groups} groups {tabs} tabs'],
    ['{date}', '{date}'],
  ])('accepts %j', (input, value) => {
    expect(validateBackupFilePattern(input)).toEqual(ok(value))
  })

  it.each([
    ['an empty name', ''],
    ['only spaces', '   '],
    ['a forward slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a parent folder', '../x'],
    ['an unknown placeholder', 'backup {user}'],
    ['an empty placeholder', 'backup {}'],
    ['a placeholder in the wrong case', 'backup {Date}'],
    ['an unclosed brace', 'backup {date'],
    ['a stray closing brace', 'backup date}'],
    ['nested braces', 'backup {{date}}'],
    ['a colon', 'backup 12:00'],
    ['an asterisk', 'backup*'],
    ['a question mark', 'backup?'],
    ['a pipe', 'a|b'],
    ['a quote', 'a"b'],
    ['angle brackets', '<backup>'],
    ['a NUL byte', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['a leading dot', '.backup'],
    ['a trailing dot', 'backup.'],
    ['a reserved name', 'CON'],
    ['a reserved name in lower case', 'nul'],
    ['a reserved name with an extension', 'COM1.backup'],
    ['an overlong name', 'x'.repeat(BACKUP_FILE_LIMITS.patternLength + 1)],
    ['a name that becomes overlong once filled in', '{date}'.repeat(16)],
  ])('rejects %s', (_name, input) => {
    const result = validateBackupFilePattern(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toBe('')
  })

  it.each([undefined, null, 5, {}])('rejects a non-string (%j)', (input) => {
    expect(validateBackupFilePattern(input).ok).toBe(false)
  })

  it('names the unknown placeholder in the message', () => {
    const result = validateBackupFilePattern('x {user}')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('{user}')
  })
})

describe('normalize (what the worker does with a stored value)', () => {
  it('keeps a valid value and replaces an invalid one with the default', () => {
    expect(normalizeBackupFolder('Backups\\Tabs')).toBe('Backups/Tabs')
    expect(normalizeBackupFolder('../..')).toBe(DEFAULT_BACKUP_FILE_FOLDER)
    expect(normalizeBackupFolder(undefined)).toBe(DEFAULT_BACKUP_FILE_FOLDER)
    expect(normalizeBackupFolder('')).toBe('')
    expect(normalizeBackupFilePattern('mine {tabs}')).toBe('mine {tabs}')
    expect(normalizeBackupFilePattern('a/b')).toBe(DEFAULT_BACKUP_FILE_PATTERN)
    expect(normalizeBackupFilePattern(42)).toBe(DEFAULT_BACKUP_FILE_PATTERN)
  })
})

describe('buildBackupFilePath', () => {
  it('builds the default path with local date and time, no colon', () => {
    expect(buildBackupFilePath(DEFAULT_BACKUP_FILE_FOLDER, DEFAULT_BACKUP_FILE_PATTERN, ctx)).toBe('TabMerger/TabMerger backup 2026-10-12 14-05-09.json')
  })

  it('fills every placeholder, every time it appears', () => {
    expect(buildBackupFilePath('a/b', '{groups}g {tabs}t {date} {date}', ctx)).toBe('a/b/3g 42t 2026-10-12 2026-10-12.json')
  })

  it('puts the file directly in Downloads for an empty folder', () => {
    expect(buildBackupFilePath('', 'backup', ctx)).toBe('backup.json')
  })

  it.each([
    ['../../Windows', 'x'],
    ['C:\\Windows', 'x'],
    ['/etc', 'x'],
    ['TabMerger', '../../evil'],
    ['TabMerger', 'a/b'],
    ['CON', 'NUL'],
    [null, undefined],
    [{}, []],
  ])('never leaves Downloads or uses an unsafe name, whatever is stored (%j, %j)', (folder, pattern) => {
    const path = buildBackupFilePath(folder, pattern, ctx)
    expect(path.endsWith('.json')).toBe(true)
    expect(path.startsWith('/')).toBe(false)
    expect(path).not.toMatch(/^[A-Za-z]:/)
    expect(path).not.toContain('\\')
    expect(path.split('/')).not.toContain('..')
    for (const segment of path.split('/')) expect(backupSegmentProblem(segment)).toBeNull()
  })

  it('falls back to the defaults when the finished path is too long', () => {
    const deep = Array.from({ length: 5 }, () => 'x'.repeat(90)).join('/')
    expect(validateBackupFolder(deep).ok).toBe(true)
    const path = buildBackupFilePath(deep, DEFAULT_BACKUP_FILE_PATTERN, ctx)
    expect(path.length).toBeLessThanOrEqual(BACKUP_FILE_LIMITS.pathLength)
    expect(path.startsWith(`${DEFAULT_BACKUP_FILE_FOLDER}/`)).toBe(true)
  })

  it('treats odd counts and times as zero instead of printing them', () => {
    expect(buildBackupFilePath('', '{groups}-{tabs}', { createdAt: ctx.createdAt, groups: -1, tabs: Number.NaN })).toBe('0-0.json')
    expect(buildBackupFilePath('', 'b {date}', { createdAt: Number.NaN, groups: 0, tabs: 0 })).toMatch(/^b \d{4}-\d{2}-\d{2}\.json$/)
  })
})

describe('Windows device names and invisible characters (hardening)', () => {
  const bad = [
    ['CONIN$', 'CONIN$'],
    ['CONOUT$', 'CONOUT$'],
    ['conin$ in lower case', 'conin$'],
    ['COM0', 'COM0'],
    ['LPT0', 'lpt0'],
    ['COM with superscript 1', 'COM\u00B9'],
    ['COM with superscript 2', 'com\u00B2'],
    ['LPT with superscript 3', 'LPT\u00B3'],
    ['LPT with superscript 1 and an extension', 'LPT\u00B9.txt'],
    ['a reserved name with a space before the dot', 'NUL .txt'],
    ['a reserved name with spaces before the dot', 'con   .json'],
    ['a C1 control character (NEL)', 'a\u0085b'],
    ['a C1 control character (CSI)', 'a\u009bb'],
    ['a zero-width space', 'a\u200Bb'],
    ['a zero-width joiner', 'a\u200Db'],
    ['a left-to-right mark', 'a\u200Eb'],
    ['a right-to-left override', 'a\u202Eb'],
    ['a bidi isolate', 'a\u2066b'],
    ['a word joiner', 'a\u2060b'],
    ['a byte order mark', 'a\uFEFFb'],
    ['a leading byte order mark', '\uFEFFbackup'],
    ['a soft hyphen', 'a\u00ADb'],
  ] as const

  it.each(bad)('folder rejects %s', (_n, input) => {
    expect(validateBackupFolder(input).ok).toBe(false)
    expect(validateBackupFolder(`TabMerger/${input}`).ok).toBe(false)
  })

  it.each(bad.filter(([, input]) => !input.includes('.')))('pattern rejects %s', (_n, input) => {
    expect(validateBackupFilePattern(input).ok).toBe(false)
  })

  it.each([
    ['com{groups}', 'com + a count becomes COM0 / COM1'],
    ['lpt{tabs}', 'lpt + a count becomes LPT0 / LPT1'],
    ['COM{groups}', 'upper case'],
    ['LPT{tabs}', 'upper case'],
    ['NUL {groups}.', 'trailing dot'],
  ])('pattern %j is rejected (%s)', (pattern) => {
    expect(validateBackupFilePattern(pattern).ok).toBe(false)
  })

  it('names with a count are fine when the name is not a device name after rendering', () => {
    expect(validateBackupFilePattern('backup {groups}').ok).toBe(true)
    expect(validateBackupFilePattern('com{groups}x').ok).toBe(true)
    expect(validateBackupFilePattern('{groups}com').ok).toBe(true)
  })

  it('still accepts ordinary names, including look-alikes and non-Latin letters', () => {
    for (const name of ['CONSOLE', 'COM10', 'LPT10', 'conin', 'console$', 'Sicherung 2026', '\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7', 'caf\u00E9']) {
      expect(validateBackupFolder(name).ok).toBe(true)
    }
  })

  it('buildBackupFilePath never produces a device name even for a stored value that slipped through', () => {
    const path = buildBackupFilePath('TabMerger', 'com{groups}', { createdAt: 0, groups: 1, tabs: 1 })
    expect(path.split('/').every((segment) => backupSegmentProblem(segment) === null)).toBe(true)
  })
})
