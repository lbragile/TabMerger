'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// TODO: import from @tabmerger/shared or packages/web/lib/workflows/tabOrganizer.ts once that file exists
type ReorganizeAction =
  | { type: 'merge'; groupIds: string[]; newName: string }
  | { type: 'rename'; groupId: string; newName: string }
  | { type: 'delete'; groupId: string; reason: string }
  | { type: 'reorder'; groupIds: string[] }

interface Props {
  runId: string
  token: string
  supabaseToken: string
}

function actionLabel(action: ReorganizeAction): string {
  switch (action.type) {
    case 'merge':
      return `Merge ${action.groupIds.length} groups → "${action.newName}"`
    case 'rename':
      return `Rename group → "${action.newName}"`
    case 'delete':
      return `Delete group (reason: ${action.reason})`
    case 'reorder':
      return `Reorder groups: ${action.groupIds.join(', ')}`
  }
}

const TYPE_VARIANT: Record<ReorganizeAction['type'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  merge: 'default',
  rename: 'secondary',
  delete: 'destructive',
  reorder: 'outline',
}

export function OrganizeProposal({ runId, token, supabaseToken }: Props) {
  const [actions, setActions] = useState<ReorganizeAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function stream() {
      try {
        const res = await fetch(`/api/ai/organize?runId=${encodeURIComponent(runId)}`, {
          headers: { Authorization: `Bearer ${supabaseToken}` },
        })
        if (!res.ok) throw new Error(`Server error ${res.status}`)
        if (!res.body) throw new Error('No response body')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          buf += decoder.decode(value, { stream: true })

          // Try to parse whatever we have so far as JSON array
          try {
            const parsed = JSON.parse(buf) as ReorganizeAction[]
            if (!cancelled) {
              // ponytail: filter "Now Open" as a safety net; backend already guards this
              setActions(parsed.filter((a) => !('newName' in a && a.newName === 'Now Open')))
            }
          } catch {
            // incomplete JSON — keep buffering
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    stream()
    return () => { cancelled = true }
  }, [runId, supabaseToken])

  async function handleDecision(approved: boolean) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/ai/organize/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseToken}`,
        },
        body: JSON.stringify({ token, approved }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      setStatus(approved ? 'approved' : 'rejected')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit decision')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'approved') {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-6 text-sm text-green-800">
          Changes applied successfully.
        </CardContent>
      </Card>
    )
  }

  if (status === 'rejected') {
    return (
      <Card className="border-muted">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Proposal cancelled.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Organization Proposal</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {loading && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Analyzing your tab groups…
          </div>
        )}

        {!loading && !error && actions.length === 0 && (
          <p className="text-sm text-muted-foreground">No changes suggested.</p>
        )}

        {actions.length > 0 && (
          <ul className="flex flex-col gap-2">
            {actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge variant={TYPE_VARIANT[action.type]} className="mt-0.5 shrink-0 capitalize">
                  {action.type}
                </Badge>
                <span>{actionLabel(action)}</span>
              </li>
            ))}
          </ul>
        )}

        {!loading && !error && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={() => handleDecision(true)}
              disabled={submitting || actions.length === 0}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDecision(false)}
              disabled={submitting}
            >
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
