import { describe, it, expect } from 'vitest'
import { BACKUP_FILE_COPY, BACKUP_FILE_DISPLAY_PATH_LENGTH, toDisplayPath } from '../constants/autoBackupFile'

describe('toDisplayPath', () => {
  it('returns an empty string for anything that is not a string', () => {
    for (const v of [undefined, null, 5, {}, [], ['a'], true]) expect(toDisplayPath(v)).toBe('')
  })
  it('leaves an ordinary path (Windows, POSIX, non-Latin) as it is', () => {
    for (const p of ['C:\\Users\\me\\Downloads\\TabMerger\\b.json', '/home/me/Downloads/b.json', '/Users/\u30e6\u30fc\u30b6\u30fc/Downloads/caf\u00e9.json']) {
      expect(toDisplayPath(p)).toBe(p)
    }
  })
  it('drops control characters', () => {
    expect(toDisplayPath('a\u0000b\nc\td\u007fe\u0085f')).toBe('abcdef')
  })
  it('drops text-direction and invisible characters, including the right-to-left override', () => {
    expect(toDisplayPath('backup\u202enosj.exe')).toBe('backupnosj.exe')
    expect(toDisplayPath('a\u200bb\u200fc\u2066d\u2069e\ufefff\u00adg\u061ch')).toBe('abcdefgh')
  })
  it('caps the length at 1024 characters and marks the cut', () => {
    const exact = 'x'.repeat(BACKUP_FILE_DISPLAY_PATH_LENGTH)
    expect(BACKUP_FILE_DISPLAY_PATH_LENGTH).toBe(1024)
    expect(toDisplayPath(exact)).toBe(exact)
    expect(toDisplayPath('x'.repeat(BACKUP_FILE_DISPLAY_PATH_LENGTH + 50))).toBe(`${exact}\u2026`)
  })
  it('cleans before capping: removed characters do not count toward the cap', () => {
    expect(toDisplayPath('\u202e'.repeat(2000) + 'ok')).toBe('ok')
  })
  it('leaves markup as plain text (the UI renders text only)', () => {
    expect(toDisplayPath('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })
  it('an all-invisible value becomes empty', () => {
    expect(toDisplayPath('\u202e\u200b\u0000')).toBe('')
  })
})

describe('BACKUP_FILE_COPY (finding the file)', () => {
  it('has the copy the Settings panel shows', () => {
    for (const key of ['whereToFind', 'lastFileLabel', 'lastFilePending', 'lastFileGone', 'showUnavailable', 'showFailed'] as const) {
      expect(BACKUP_FILE_COPY[key].length).toBeGreaterThan(5)
    }
    expect(BACKUP_FILE_COPY.showInFolder).toBe('Show in folder')
    expect(BACKUP_FILE_COPY.showDownloadsFolder).toBe('Open Downloads folder')
  })
})
