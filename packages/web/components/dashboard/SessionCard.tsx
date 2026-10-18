'use client'

import { useId, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { LockedItemNote } from '@/components/dashboard/LockedItemNote'
import { toHttpUrl } from '@tabmerger/shared'

/** Shown inside an item whose content decrypted but is not in a shape TabMerger can show. */

// ponytail: inline datetime format — no need for full Intl config overhead
const formatDateTime = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(date))

interface SessionTab {
  url: string
  title?: string
}

interface SessionWindow {
  tabs?: SessionTab[]
}

interface SessionGroup {
  name?: string
  color?: string
  windows?: SessionWindow[]
}

interface SessionCardProps {
  id: string
  name: string
  description?: string | null
  groups?: SessionGroup[]
  groupCount: number
  windowCount: number
  tabCount: number
  createdAt: string
  /**
   * The session's content could not be decrypted with the current key: `name` and `groups` are
   * placeholders. The card says why, shows no counts, and Restore is refused (it would open
   * nothing). Delete stays available: removing a session needs only its id.
   */
  locked?: boolean
  /**
   * The content was read but is not a list of groups TabMerger understands. Treated like `locked`
   * (no counts, no Restore, Delete available) with its own explanation.
   */
  damaged?: boolean
  onDelete?: (id: string) => void
  onRestore?: (id: string) => void
}

export function SessionCard({
  id,
  name,
  description,
  groups,
  groupCount,
  windowCount,
  tabCount,
  createdAt,
  locked = false,
  damaged = false,
  onDelete,
  onRestore,
}: SessionCardProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const lockedNoteId = useId()
  const contentsId = useId()
  const hasContents = !!groups && groups.length > 0
  // Either way there is nothing to open: Restore is refused and the counts are not shown.
  const unreadable = locked || damaged

  return (
    // min-w-0 lets this card shrink to its grid track instead of being pushed wide by
    // long titles/urls inside — the earlier overflow came from flex children defaulting
    // to min-width:auto and a hard-coded w-[280px] side panel that didn't fit at 3-up.
    <div className="min-w-0 border border-border rounded-lg overflow-hidden bg-surface p-4 transition-shadow duration-200 hover:shadow-sh2">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-bold truncate min-w-0" style={{ fontSize: '17px' }}>{locked ? t('lockedName') : name}</h3>
        <div className="flex items-center gap-1 shrink-0">
          <TooltipProvider>
            {onRestore && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* aria-disabled, not disabled, when locked: the control stays reachable by
                      keyboard so the reason (tooltip and the card's note) can be read. */}
                  <button
                    onClick={unreadable ? undefined : () => onRestore(id)}
                    aria-label={t('sessions.restore')}
                    aria-disabled={unreadable ? true : undefined}
                    aria-describedby={unreadable ? lockedNoteId : undefined}
                    className={`text-muted-foreground rounded-md p-1 ${unreadable ? 'opacity-50 cursor-not-allowed' : 'hover:text-foreground'}`}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {unreadable ? t('sessions.cantRestoreTooltip') : t('sessions.restore')}
                </TooltipContent>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onDelete(id)}
                    aria-label={t('sessions.delete')}
                    className="text-destructive hover:text-destructive/80 rounded-md p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('sessions.delete')}</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </div>
      {locked ? (
        // Instead of the counts: the placeholder's "0 groups, 0 tabs" is not what the session holds.
        <LockedItemNote id={lockedNoteId} className="mb-2" />
      ) : damaged ? (
        <p id={lockedNoteId} className="mb-2 text-xs text-muted-foreground">{t('damagedNote')}</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-2">
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{t('counts.groups', { count: groupCount })}</span>
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{t('counts.windows', { count: windowCount ?? 0 })}</span>
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{t('counts.tabs', { count: tabCount })}</span>
        </div>
      )}
      {hasContents && tabCount > 0 && (
        <div className="flex h-1.5 w-full rounded-full overflow-hidden mb-2">
          {groups!.map((group, i) => {
            const groupTabs = (group.windows ?? []).reduce((s, w) => s + (w.tabs?.length ?? 0), 0)
            return (
              <div
                key={i}
                data-testid="progress-segment"
                style={{
                  width: `${(groupTabs / tabCount) * 100}%`,
                  background: group.color ?? 'var(--color-divider)',
                }}
              />
            )
          })}
        </div>
      )}
      <p className="text-[12px] text-text2 mb-3">{formatDateTime(createdAt, locale)}</p>
      {description && (
        <p className="text-[12px] italic text-text2 mb-3 truncate">{description}</p>
      )}

      {/* Contents — collapsed by default, mirrors GroupGrid's "Show tabs" pattern instead
          of a fixed-width side panel (which is what overflowed at 3-column density). */}
      {hasContents && (
        <div className="mb-3">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={contentsId}
            className="text-xs text-text2 hover:text-foreground px-2 py-1 -ml-2 rounded-md border border-transparent hover:border-border transition-colors cursor-pointer"
          >
            {open ? t('sessions.hideContents') : t('sessions.showContents', { count: groups!.length })}
          </button>
          {open && <SessionGroupsPreview id={contentsId} groups={groups!} className="mt-2" />}
        </div>
      )}
    </div>
  )
}

/**
 * The groups and tabs inside a session or an automatic backup. Names, titles and addresses are
 * user data: they are rendered as text only. With `linkTabs`, a tab whose address is http(s)
 * (`toHttpUrl`) becomes a link; any other tab stays plain text.
 */
export function SessionGroupsPreview({
  groups,
  maxGroups = 3,
  maxTabs = 2,
  linkTabs = false,
  id,
  className,
}: {
  groups: SessionGroup[]
  /** Groups shown before "+N more groups". */
  maxGroups?: number
  /** Tabs shown per group before "+N more tabs" (the count is only said when `linkTabs` is on). */
  maxTabs?: number
  linkTabs?: boolean
  id?: string
  className?: string
}) {
  const t = useTranslations('dashboard.sessions')
  return (
    <div id={id} className={`space-y-2 ${className ?? ''}`}>
      {groups.slice(0, maxGroups).map((group, i) => {
        const allTabs = (group.windows ?? []).flatMap((w) => w.tabs ?? [])
        return (
          <div key={i} className="min-w-0">
            <div className="flex items-center gap-2 mb-1 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: group.color ?? 'var(--color-divider)' }}
              />
              <span className="font-bold text-[12px] truncate flex-1 min-w-0">{group.name ?? t('groupFallbackName', { number: i + 1 })}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">{t('groupTabs', { count: allTabs.length })}</span>
            </div>
            {allTabs.slice(0, maxTabs).map((tab, j) => {
              const href = linkTabs ? toHttpUrl(tab.url) : undefined
              return (
                <p key={j} className="text-[11px] text-muted-foreground truncate pl-4">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline hover:text-foreground">
                      {tab.title || tab.url}
                    </a>
                  ) : (
                    tab.title || tab.url
                  )}
                </p>
              )
            })}
            {linkTabs && allTabs.length > maxTabs && (
              <p className="text-[11px] text-muted-foreground pl-4">{t('moreTabs', { count: allTabs.length - maxTabs })}</p>
            )}
          </div>
        )
      })}
      {groups.length > maxGroups && (
        <p className="text-[11px] text-muted-foreground">{t('moreGroups', { count: groups.length - maxGroups })}</p>
      )}
    </div>
  )
}
