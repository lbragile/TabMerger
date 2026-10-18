'use client'

import { useTranslations } from 'next-intl'
import { useSavedSessions } from '@/components/dashboard/SavedSessionsProvider'

/**
 * The "Sessions stored" number. The server only knows how many `sessions` rows there are; which
 * of them are automatic backups is known after they are decrypted in the browser. So: the saved
 * sessions once that is known, the row total while the rows are locked (the description then says
 * the total includes backups), and a placeholder while they are being read.
 */
export function SessionsStatValue() {
  const { status, sessions, totalRows } = useSavedSessions()
  const t = useTranslations('dashboard.stats')
  if (status === 'ready') return <>{sessions.length}</>
  if (status === 'locked' || status === 'error') return <>{totalRows}</>
  return (
    <>
      <span aria-hidden="true">…</span>
      <span className="sr-only">{t('loading')}</span>
    </>
  )
}

export function SessionsStatDescription() {
  const { status } = useSavedSessions()
  const t = useTranslations('dashboard.stats')
  return <>{status === 'locked' ? t('sessions.lockedDescription') : t('sessions.description')}</>
}
