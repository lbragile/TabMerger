import { describe, it, expect } from 'vitest'
import { ACCOUNT_SCOPED_SETTING_KEYS, AUTO_BACKUP_FILE_LAST_KEY, AUTO_BACKUP_FILE_STATUS_KEY } from '@/lib/syncSettingKeys'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCAL_ONLY_SYNC_KEYS } from '@tabmerger/shared'

const read = (file: string) => readFileSync(resolve(__dirname, '../../../lib', file), 'utf-8')
const syncEngineSource = read('syncEngine.ts')
const downloadSource = read('autoBackupDownload.ts')

describe('autoBackupFileLast stays on this device', () => {
  it('has the documented key name', () => {
    expect(AUTO_BACKUP_FILE_LAST_KEY).toBe('autoBackupFileLast')
  })

  it('is cleared by the account wipe (account-scoped) together with the file status', () => {
    expect(ACCOUNT_SCOPED_SETTING_KEYS).toContain(AUTO_BACKUP_FILE_LAST_KEY)
    expect(ACCOUNT_SCOPED_SETTING_KEYS).toContain(AUTO_BACKUP_FILE_STATUS_KEY)
  })

  it('is never read by the code that uploads to or downloads from the account', () => {
    // A browser download id means nothing on another device: the sync and backup-download paths
    // must not carry it, so nothing here may mention the key or its stored name.
    for (const source of [syncEngineSource, downloadSource]) {
      expect(source).not.toContain('AUTO_BACKUP_FILE_LAST_KEY')
      expect(source).not.toContain('autoBackupFileLast')
    }
  })

  it('is a settings-store key, not a field of anything synced', () => {
    expect(LOCAL_ONLY_SYNC_KEYS as readonly string[]).not.toContain('autoBackupFileLast')
  })
})
