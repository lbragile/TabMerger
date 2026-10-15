import { describe, it, expect } from 'vitest'
import {
  AUTO_BACKUP_ALARM_NAME,
  AUTO_BACKUP_COPY,
  AUTO_BACKUP_DUE_TOLERANCE_MS,
  AUTO_BACKUP_INTERVALS,
  AUTO_BACKUP_MESSAGE,
  AUTO_BACKUP_RETENTION_COUNT,
  DEFAULT_AUTO_BACKUP_ENABLED,
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  PRICING_TIERS,
  autoBackupName,
  isAutoBackupDue,
  isAutoBackupInterval,
  normalizeAutoBackupEnabled,
  normalizeAutoBackupInterval,
} from '../index'

const MIN = 60 * 1000

describe('automatic backup constants', () => {
  it('offers exactly the five allowed intervals, in order', () => {
    expect(AUTO_BACKUP_INTERVALS.map((i) => i.minutes)).toEqual([60, 360, 720, 1440, 10080])
  })

  it('defaults to daily, on, keeping 10', () => {
    expect(DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES).toBe(1440)
    expect(DEFAULT_AUTO_BACKUP_ENABLED).toBe(true)
    expect(AUTO_BACKUP_RETENTION_COUNT).toBe(10)
  })

  it('the alarm name does not collide with the reminder alarms prefix', () => {
    expect(AUTO_BACKUP_ALARM_NAME.startsWith('reminder-')).toBe(false)
  })

  it('has three distinct message types', () => {
    const values = Object.values(AUTO_BACKUP_MESSAGE)
    expect(new Set(values).size).toBe(3)
  })
})

describe('isAutoBackupInterval / normalizeAutoBackupInterval', () => {
  it.each(AUTO_BACKUP_INTERVALS.map((i) => i.minutes))('accepts %i', (m) => {
    expect(isAutoBackupInterval(m)).toBe(true)
    expect(normalizeAutoBackupInterval(m)).toBe(m)
  })

  it.each([
    ['numeric string', '60'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['float near an allowed value', 60.5],
    ['zero', 0],
    ['negative', -60],
    ['not on the list', 30],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['boolean', true],
  ])('rejects %s and falls back to the default', (_n, v) => {
    expect(isAutoBackupInterval(v)).toBe(false)
    expect(normalizeAutoBackupInterval(v)).toBe(DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES)
  })
})

describe('normalizeAutoBackupEnabled', () => {
  it('keeps real booleans', () => {
    expect(normalizeAutoBackupEnabled(true)).toBe(true)
    expect(normalizeAutoBackupEnabled(false)).toBe(false)
  })

  it.each([['"false"', 'false'], ['0', 0], ['1', 1], ['null', null], ['undefined', undefined], ['object', {}]])(
    'takes the default for %s',
    (_n, v) => {
      expect(normalizeAutoBackupEnabled(v)).toBe(DEFAULT_AUTO_BACKUP_ENABLED)
    }
  )
})

describe('isAutoBackupDue', () => {
  const now = Date.UTC(2030, 5, 15, 12, 0, 0)

  it.each([['undefined', undefined], ['null', null], ['zero', 0], ['negative', -5], ['NaN', NaN], ['Infinity', Infinity], ['string', '123']])(
    'treats %s as never backed up',
    (_n, v) => {
      expect(isAutoBackupDue(v, 1440, now)).toBe(true)
    }
  )

  it('counts a stamp in the future (clock moved back) as due', () => {
    expect(isAutoBackupDue(now + 1, 10080, now)).toBe(true)
    expect(isAutoBackupDue(now + 365 * 24 * 60 * MIN, 60, now)).toBe(true)
  })

  it.each(AUTO_BACKUP_INTERVALS.map((i) => i.minutes))('interval %i min: edges around the interval minus the 2-minute tolerance', (m) => {
    const full = m * MIN
    const edge = full - AUTO_BACKUP_DUE_TOLERANCE_MS
    expect(AUTO_BACKUP_DUE_TOLERANCE_MS).toBe(2 * MIN)
    expect(isAutoBackupDue(now - edge - 1, m, now)).toBe(true)
    expect(isAutoBackupDue(now - edge, m, now)).toBe(true) // exactly at the edge
    expect(isAutoBackupDue(now - edge + 1, m, now)).toBe(false)
    expect(isAutoBackupDue(now - full, m, now)).toBe(true)
    expect(isAutoBackupDue(now - 1000, m, now)).toBe(false)
  })

  it('an hourly alarm finding 59m58s elapsed is still due', () => {
    expect(isAutoBackupDue(now - (59 * MIN + 58 * 1000), 60, now)).toBe(true)
  })

  it('a stamp equal to now is not due', () => {
    expect(isAutoBackupDue(now, 60, now)).toBe(false)
  })
})

describe('autoBackupName', () => {
  it('starts with the prefix and a separator', () => {
    const name = autoBackupName(Date.UTC(2030, 9, 11, 14, 0, 0), 'en-US')
    expect(name.startsWith(`${AUTO_BACKUP_COPY.namePrefix} · `)).toBe(true)
  })

  it('formats month, day and time for en-US', () => {
    const d = new Date(2030, 9, 11, 14, 5, 0) // local time, so the expected text is timezone independent
    expect(autoBackupName(d.getTime(), 'en-US')).toBe('Automatic backup · Oct 11, 2:05 PM')
  })

  it('defaults to en-US when no locale is given', () => {
    const t = new Date(2030, 0, 2, 9, 30, 0).getTime()
    expect(autoBackupName(t)).toBe(autoBackupName(t, 'en-US'))
  })
})

describe('Pro pricing feature line', () => {
  it('is in the Pro tier feature list and in no other tier', () => {
    const withLine = PRICING_TIERS.filter((t) => t.features.includes(AUTO_BACKUP_COPY.pricingFeature))
    expect(withLine.map((t) => t.id)).toEqual(['pro'])
  })

  it('has the expected copy', () => {
    expect(AUTO_BACKUP_COPY.pricingFeature).toBe('Automatic encrypted backups of your groups, with an optional file copy on your computer')
  })
})

describe('AUTO_BACKUP_COPY read-only note', () => {
  it('tells a plan without cloud sync that new backups need Pro but existing ones stay available', () => {
    expect(AUTO_BACKUP_COPY.readOnlyNote).toBe('New backups need Pro. Your existing backups can still be downloaded or deleted.')
    expect(AUTO_BACKUP_COPY.readOnlyNote).not.toBe(AUTO_BACKUP_COPY.upgradeDescription)
  })
})
