import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, Layers, Trash2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface SessionCardProps {
  id: string
  name: string
  description?: string | null
  groupCount: number
  createdAt: string
  onDelete?: (id: string) => void
}

export function SessionCard({
  id,
  name,
  description,
  groupCount,
  createdAt,
  onDelete,
}: SessionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold leading-tight">
            {name}
          </CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="secondary" className="gap-1">
              <Layers className="h-3 w-3" />
              {groupCount} {groupCount === 1 ? 'group' : 'groups'}
            </Badge>
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
            <span>{formatDate(createdAt)}</span>
          </div>
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
      </CardContent>
    </Card>
  )
}
