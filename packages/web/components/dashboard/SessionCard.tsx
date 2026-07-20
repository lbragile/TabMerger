'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, Info, Layers, Trash2 } from 'lucide-react'

// ponytail: inline datetime format — formatDate is date-only; no need to change shared util
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
  onDelete,
  onRestore,
}: SessionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <CardTitle className="text-base font-semibold leading-tight truncate">
              {name}
            </CardTitle>
            {groups && groups.length > 0 && (
              <Tooltip.Provider delayDuration={200}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" aria-label="Preview session contents">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="z-50 max-w-xs rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
                      sideOffset={6}
                    >
                      <p className="font-semibold mb-2 text-sm">{name}</p>
                      <ul className="space-y-1">
                        {groups.map((g, i) => {
                          const tabs = (g.windows ?? []).reduce(
                            (sum, w) => sum + (w.tabs?.length ?? 0),
                            0
                          )
                          return (
                            <li key={i} className="flex items-center justify-between gap-4">
                              <span className="text-foreground truncate max-w-[160px]">
                                {g.name ?? `Group ${i + 1}`}
                              </span>
                              <span className="text-muted-foreground shrink-0">
                                {p(tabs, 'tab')}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                      <Tooltip.Arrow className="fill-border" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Layers className="h-3 w-3" />
              {p(groupCount, 'group')}
            </Badge>
            <Badge variant="secondary">{p(windowCount ?? 0, 'window')}</Badge>
            <Badge variant="secondary">{p(tabCount ?? 0, 'tab')}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {description && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {description}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatDateTime(createdAt)}</span>
          </div>
          <div className="flex items-center gap-1">
            {onRestore && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onRestore(id)}
              >
                Restore
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Delete session</span>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
