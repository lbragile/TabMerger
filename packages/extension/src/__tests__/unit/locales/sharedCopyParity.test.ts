import { describe, expect, it } from 'vitest'
import {
  AI_COMING_SOON_LABEL,
  AUTO_BACKUP_COPY,
  AUTO_BACKUP_INTERVALS,
  AUTO_BACKUP_RETENTION_COUNT,
  BACKUP_FILE_COPY,
  FIRST_GROUP_TITLE,
  FREE_TIER_LIMITS,
  PRICING_TIERS,
  SEARCH_COPY,
  SEARCH_NON_MATCHING_OPTIONS
} from '@tabmerger/shared'
import { t } from '@/lib/i18n'
import { TOUR_MENU_LABELS } from '@/lib/tourTasks'

/**
 * Some English copy also lives in @tabmerger/shared (the web app shows it too). The extension
 * renders its own catalog so it can be translated; these keep the two English texts identical.
 */
describe('extension catalog matches the shared English copy', () => {
  it('search', () => {
    expect(t('search.settingLabel')).toBe(SEARCH_COPY.settingLabel)
    expect(t('search.settingDescription')).toBe(SEARCH_COPY.settingDescription)
    expect(t('search.clearSearch')).toBe(SEARCH_COPY.clearSearch)
    expect(t('search.openSearch')).toBe(SEARCH_COPY.openSearch)
    expect(t('search.openSearchWithQuery', { query: 'q' })).toBe(`${SEARCH_COPY.openSearch}, ${SEARCH_COPY.currentSearch}: q`)
    expect(t('search.searchInput')).toBe(SEARCH_COPY.searchInput)
    expect(t('search.noMatchSuffix')).toBe(SEARCH_COPY.noMatchSuffix)
    expect(t('search.reorderLocked')).toBe(SEARCH_COPY.reorderLocked)
    expect(t('search.focusMoved', { title: 'X' })).toBe(SEARCH_COPY.focusMoved('X'))
    expect(t('search.noResults')).toBe(SEARCH_COPY.resultCount(0))
    for (const n of [1, 2, 7]) expect(t('search.resultCount', { count: n })).toBe(SEARCH_COPY.resultCount(n))
    expect(SEARCH_NON_MATCHING_OPTIONS.map((o) => o.label)).toEqual([t('search.hide'), t('search.dim')])
  })

  it('automatic backups and the backup file', () => {
    expect(t('backups.title')).toBe(AUTO_BACKUP_COPY.title)
    expect(t('backups.description', { count: AUTO_BACKUP_RETENTION_COUNT })).toBe(AUTO_BACKUP_COPY.description)
    expect(t('backups.upgradeDescription', { count: AUTO_BACKUP_RETENTION_COUNT })).toBe(AUTO_BACKUP_COPY.upgradeDescription)
    expect(t('backups.deleteScope')).toBe(AUTO_BACKUP_COPY.deleteScope)
    for (const option of AUTO_BACKUP_INTERVALS) expect(t(`backups.interval.${option.minutes}`)).toBe(option.label)
    for (const [key, text] of Object.entries(BACKUP_FILE_COPY)) {
      expect(t(`backups.file.${key as keyof typeof BACKUP_FILE_COPY}`)).toBe(text)
    }
  })

  it('pricing in the upgrade prompt', () => {
    expect(t('upgrade.comingSoon')).toBe(AI_COMING_SOON_LABEL)
    for (const plan of PRICING_TIERS) {
      expect(t(`upgrade.plans.${plan.id}.name`)).toBe(plan.name)
      plan.features.slice(0, 3).forEach((feature, i) => {
        expect(t(`upgrade.plans.${plan.id}.f${(i + 1) as 1 | 2 | 3}`, FREE_TIER_LIMITS)).toBe(feature)
      })
    }
  })

  it('the permanent group name', () => {
    expect(t('common.nowOpen')).toBe(FIRST_GROUP_TITLE)
  })

  it('the tour quotes the menu items by their real text', () => {
    expect(TOUR_MENU_LABELS.openWindow).toBe(t('window.openInBrowser'))
    expect(TOUR_MENU_LABELS.deduplicate).toBe(t('groupMenu.deduplicate'))
  })
})
