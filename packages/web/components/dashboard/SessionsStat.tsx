'use client'

import { useSavedSessions } from '@/components/dashboard/SavedSessionsProvider'

/**
 * The "Sessions stored" number. The server only knows how many `sessions` rows there are; which
 * of them are automatic backups is known after they are decrypted in the browser. So: the saved
 * sessions once that is known, the row total while the rows are locked (the description then says
 * the total includes backups), and a placeholder while they are being read.
 */
export function SessionsStatValue() {
  const { status, sessions, totalRows } = useSavedSessions()
  if (status === 'ready') return <>{sessions.length}</>
  if (status === 'locked' || status === 'error') return <>{totalRows}</>
  return (
    <>
      <span aria-hidden="true">…</span>
      <span className="sr-only">Loading</span>
    </>
  )
}

export function SessionsStatDescription() {
  const { status } = useSavedSessions()
  return <>{status === 'locked' ? 'Sessions and backups (unlock to tell them apart)' : 'Browsing sessions stored'}</>
}
