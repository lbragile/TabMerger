'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Trash2 } from 'lucide-react'
import { AUTO_BACKUP_RETENTION_COUNT, DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES } from '@tabmerger/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PassphrasePrompt } from '@/components/dashboard/PassphrasePrompt'
import { useSavedSessions } from '@/components/dashboard/SavedSessionsProvider'
import { SessionGroupsPreview } from '@/components/dashboard/SessionCard'
import {
  backupFileContent,
  backupFileName,
  countTabs,
  createdAtMs,
  formatAbsoluteTime,
  formatRelativeTime,
  type SavedItem,
} from '@/lib/savedSessions'


/** Groups and tabs listed when a backup is expanded; the rest is summarised ("+N more"). */
const PREVIEW_GROUPS = 50
const PREVIEW_TABS_PER_GROUP = 20

type DashboardT = ReturnType<typeof useTranslations<'dashboard'>>

/** When a backup was made, for a sentence ("the backup from …"), in the viewer's locale and time zone. */
function whenLabel(item: SavedItem, t: DashboardT): string {
  const ms = createdAtMs(item)
  return ms === null ? t('backups.unknownDateInSentence') : formatAbsoluteTime(ms)
}

/** Saves the backup as a JSON file through a temporary link. The file is built in the browser from the decrypted content. */
function downloadBackup(item: SavedItem) {
  const url = URL.createObjectURL(new Blob([backupFileContent(item)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = backupFileName(item)
  document.body.append(link)
  link.click()
  link.remove()
  // Not at once: some browsers start reading the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The dashboard's "Backups" section: the automatic backups the extension saved to the account
 * (rows of `sessions` whose decrypted content says `auto: true`), newest first. Each can be
 * expanded, downloaded as a file the extension's import reads, and deleted after a confirmation.
 * Restoring is not offered here: it is done in the extension.
 *
 * `syncEnabled` false (free, or a paid plan that is not active) shows what the feature is and the
 * upgrade link. Backups the account saved while it had Pro are still listed, read-only: download
 * and delete only, with a note that new backups need Pro.
 */
export function BackupsSection({ syncEnabled }: { syncEnabled: boolean }) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { status, backups, unknownKind, totalRows } = useSavedSessions()
  /**
   * Whether the rows part of the section is shown. Always with cloud sync. Without it (free, or a
   * paid plan that is not active) only while the account may still hold backups saved before:
   * those stay readable, downloadable and deletable (RLS allows SELECT and DELETE at any plan),
   * and nothing in this section creates or changes a row.
   */
  const showRows =
    syncEnabled ||
    status === 'error' ||
    (status === 'ready' ? backups.length > 0 || unknownKind > 0 : totalRows > 0)
  const [deleteTarget, setDeleteTarget] = useState<SavedItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  /** Said by screen readers when something happens that is otherwise only seen (a toast, a row leaving). */
  const [announcement, setAnnouncement] = useState('')
  /**
   * What gets focus when the confirmation closes: the Delete button that opened it, or the section
   * heading once its row is gone. Radix only restores focus to a `DialogTrigger`, and this dialog
   * is opened from whichever row was chosen, so without this focus would fall to the page body.
   */
  const focusAfterCloseRef = useRef<HTMLElement | null>(null)
  // Relative times are measured from when the section was first shown; a lazy initializer keeps render pure.
  const [now] = useState(() => Date.now())
  const t = useTranslations('dashboard')
  const passphrase = useTranslations('dashboard.passphrase')
  const extensionPlace = t('backups.extensionPlace')

  function handleDownload(item: SavedItem) {
    downloadBackup(item)
    setAnnouncement(t('backups.downloading', { when: whenLabel(item, t) }))
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleting(true)
    let ok = false
    try {
      ok = (await fetch(`/api/sessions/${encodeURIComponent(target.id)}`, { method: 'DELETE' })).ok
    } catch {
      ok = false
    }
    setDeleting(false)
    setDeleteTarget(null)
    if (ok) {
      toast.success(t('backups.deleted'))
      setAnnouncement(t('backups.deletedAnnouncement', { when: whenLabel(target, t) }))
      // The row (and the button that had focus) is about to leave the page.
      focusAfterCloseRef.current = headingRef.current
      startTransition(() => {
        router.refresh()
      })
    } else {
      toast.error(t('backups.deleteFailed'))
      setAnnouncement(t('backups.deleteFailedAnnouncement', { when: whenLabel(target, t) }))
    }
  }

  return (
    <section aria-labelledby={headingId} id="backups" className="scroll-mt-20">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold mb-1 focus:outline-none">
        {t('backups.title')}
      </h2>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!syncEnabled && (
        <div className="mt-3 mb-4 rounded-lg border border-dashed p-6 flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground max-w-prose">{t('backups.upgradeDescription', { count: AUTO_BACKUP_RETENTION_COUNT })}</p>
          {showRows && <p className="text-sm text-muted-foreground max-w-prose">{t('backups.readOnlyNote')}</p>}
          <Button size="sm" asChild>
            <Link href="/pricing">{t('backups.upgrade')}</Link>
          </Button>
        </div>
      )}

      {showRows && (
        <>
          {syncEnabled && (
            <p className="text-sm text-muted-foreground mb-4 max-w-prose">
              {t('backups.intro', { count: AUTO_BACKUP_RETENTION_COUNT, place: extensionPlace })}
            </p>
          )}

          {status === 'error' && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <p>{t('backups.loadFailed')}</p>
              <Button variant="outline" size="sm" onClick={() => startTransition(() => router.refresh())} loading={isPending}>
                {t('backups.tryAgain')}
              </Button>
            </div>
          )}

          {status === 'locked' && (
            <PassphrasePrompt label={passphrase('backupsLabel')} />
          )}

          {(status === 'checking' || status === 'loading') && (
            <div role="status" aria-label={t('backups.loading')} className="flex flex-col gap-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {status === 'ready' && (
            <>
              {unknownKind > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  {t('backups.unknownKind', { count: unknownKind })}
                </p>
              )}
              {backups.length === 0 ? (
                // Without cloud sync the extension saves no new backups, so the "how they are made" text does not apply.
                syncEnabled && (
                  <div className="text-sm text-muted-foreground max-w-prose">
                    <p className="font-medium text-foreground">{t('backups.emptyTitle')}</p>
                    <p className="mt-1">
                      {t('backups.emptyBody', {
                        interval: t(`backups.intervals.${DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES}`),
                        place: extensionPlace,
                      })}
                    </p>
                  </div>
                )
              ) : (
                <ul className={`flex flex-col gap-3 min-w-0 ${isPending ? 'opacity-70 pointer-events-none' : ''}`}>
                  {backups.map((backup) => (
                    <BackupRow
                      key={backup.id}
                      backup={backup}
                      now={now}
                      onDownload={() => handleDownload(backup)}
                      onDelete={(opener) => {
                        focusAfterCloseRef.current = opener
                        setDeleteTarget(backup)
                      }}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            focusAfterCloseRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('backups.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? deleteTarget.damaged
                  ? t('backups.deleteBody', { when: whenLabel(deleteTarget, t) })
                  : t('backups.deleteBodyWithCounts', {
                      when: whenLabel(deleteTarget, t),
                      groups: t('counts.groups', { count: deleteTarget.groups.length }),
                      tabs: t('counts.tabs', { count: countTabs(deleteTarget.groups) }),
                    })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('backups.cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete} loading={deleting}>
              {t('backups.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function BackupRow({
  backup,
  now,
  onDownload,
  onDelete,
}: {
  backup: SavedItem
  now: number
  onDownload: () => void
  /** Called with the button that was pressed, so focus can return to it. */
  onDelete: (opener: HTMLElement) => void
}) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('dashboard')
  const contentsId = useId()
  const titleId = useId()
  const ms = createdAtMs(backup)
  const when = whenLabel(backup, t)
  const groupCount = backup.groups.length
  const tabCount = countTabs(backup.groups)

  return (
    <li className="min-w-0 border border-border rounded-lg bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={titleId} className="font-bold text-[0.9375rem] break-words">
            {ms === null ? t('backups.unknownDate') : <time dateTime={new Date(ms).toISOString()}>{when}</time>}
          </h3>
          <p className="text-xs text-text2">
            {t('backups.namePrefix')}
            {ms !== null && <> · {formatRelativeTime(ms, now)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!backup.damaged && (
            <Button variant="outline" size="sm" onClick={onDownload} aria-label={t('backups.downloadLabel', { when })}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('backups.download')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => onDelete(event.currentTarget)}
            aria-label={t('backups.deleteLabel', { when })}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('backups.delete')}
          </Button>
        </div>
      </div>

      {backup.damaged ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('damagedNote')}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="text-[0.75rem] bg-surface3 px-2 py-0.5 rounded-md">{t('counts.groups', { count: groupCount })}</span>
          <span className="text-[0.75rem] bg-surface3 px-2 py-0.5 rounded-md">{t('counts.tabs', { count: tabCount })}</span>
        </div>
      )}

      {groupCount > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={contentsId}
            aria-describedby={titleId}
            className="text-xs text-text2 hover:text-foreground px-2 py-1 -ml-2 rounded-md border border-transparent hover:border-border transition-colors cursor-pointer"
          >
            {open ? t('sessions.hideContents') : t('sessions.showContents', { count: groupCount })}
          </button>
          {open && (
            <SessionGroupsPreview
              id={contentsId}
              groups={backup.groups}
              maxGroups={PREVIEW_GROUPS}
              maxTabs={PREVIEW_TABS_PER_GROUP}
              linkTabs
              className="mt-2"
            />
          )}
        </div>
      )}
    </li>
  )
}
