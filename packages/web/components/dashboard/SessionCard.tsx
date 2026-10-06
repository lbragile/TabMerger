'use client'

import { useId, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { LockedItemNote } from '@/components/dashboard/LockedItemNote'

// ponytail: inline datetime format — no need for full Intl config overhead
const formatDateTime = (date: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(date))

const p = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

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
  onDelete,
  onRestore,
}: SessionCardProps) {
  const [open, setOpen] = useState(false)
  const lockedNoteId = useId()
  const hasContents = !!groups && groups.length > 0

  return (
    // min-w-0 lets this card shrink to its grid track instead of being pushed wide by
    // long titles/urls inside — the earlier overflow came from flex children defaulting
    // to min-width:auto and a hard-coded w-[280px] side panel that didn't fit at 3-up.
    <div className="min-w-0 border border-border rounded-lg overflow-hidden bg-surface p-4 transition-shadow duration-200 hover:shadow-sh2">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-bold truncate min-w-0" style={{ fontSize: '17px' }}>{name}</h3>
        <div className="flex items-center gap-1 shrink-0">
          <TooltipProvider>
            {onRestore && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* aria-disabled, not disabled, when locked: the control stays reachable by
                      keyboard so the reason (tooltip and the card's note) can be read. */}
                  <button
                    onClick={locked ? undefined : () => onRestore(id)}
                    aria-label="Restore session"
                    aria-disabled={locked ? true : undefined}
                    aria-describedby={locked ? lockedNoteId : undefined}
                    className={`text-muted-foreground rounded-md p-1 ${locked ? 'opacity-50 cursor-not-allowed' : 'hover:text-foreground'}`}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {locked ? "This session can't be read, so it can't be restored" : 'Restore session'}
                </TooltipContent>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onDelete(id)}
                    aria-label="Delete session"
                    className="text-destructive hover:text-destructive/80 rounded-md p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Delete session</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </div>
      {locked ? (
        // Instead of the counts: the placeholder's "0 groups, 0 tabs" is not what the session holds.
        <LockedItemNote id={lockedNoteId} className="mb-2" />
      ) : (
        <div className="flex flex-wrap gap-2 mb-2">
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{p(groupCount, 'group')}</span>
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{p(windowCount ?? 0, 'window')}</span>
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{p(tabCount, 'tab')}</span>
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
      <p className="text-[12px] text-text2 mb-3">{formatDateTime(createdAt)}</p>
      {description && (
        <p className="text-[12px] italic text-text2 mb-3 truncate">{description}</p>
      )}

      {/* Contents — collapsed by default, mirrors GroupGrid's "Show tabs" pattern instead
          of a fixed-width side panel (which is what overflowed at 3-column density). */}
      {hasContents && (
        <div className="mb-3">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-text2 hover:text-foreground px-2 py-1 -ml-2 rounded-md border border-transparent hover:border-border transition-colors cursor-pointer"
          >
            {open ? 'Hide contents' : `Show contents (${groups!.length})`}
          </button>
          {open && (
            <div className="mt-2 space-y-2">
              {groups!.slice(0, 3).map((group, i) => {
                const allTabs = (group.windows ?? []).flatMap((w) => w.tabs ?? [])
                return (
                  <div key={i} className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: group.color ?? 'var(--color-divider)' }}
                      />
                      <span className="font-bold text-[12px] truncate flex-1 min-w-0">{group.name ?? `Group ${i + 1}`}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{allTabs.length} tabs</span>
                    </div>
                    {allTabs.slice(0, 2).map((tab, j) => (
                      <p key={j} className="text-[11px] text-muted-foreground truncate pl-4">{tab.title || tab.url}</p>
                    ))}
                  </div>
                )
              })}
              {groups!.length > 3 && (
                <p className="text-[11px] text-muted-foreground">+{groups!.length - 3} more groups</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
