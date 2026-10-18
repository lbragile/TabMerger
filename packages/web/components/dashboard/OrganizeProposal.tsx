'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// Type-only import: erased at compile time, so the workflow module (and its
// server-only `workflow` / service-role Supabase imports) never reaches the bundle.
import type { ReorganizeAction } from '@/lib/workflows/tabOrganizer'

interface Props {
  runId: string
  token: string
  supabaseToken: string
  /**
   * True when any of the user's groups are stored as client-side ciphertext.
   * The web dashboard isn't an E2EE client yet (no passphrase prompt / data key
   * here), so it has no plaintext to review and approving would apply only the
   * content-free actions server-side. Refuse explicitly rather than showing a
   * proposal derived from unreadable data.
   */
  encrypted?: boolean
}

type OrganizeT = ReturnType<typeof useTranslations<'organize'>>

function actionLabel(action: ReorganizeAction, t: OrganizeT): string {
  switch (action.type) {
    case 'merge':
      return t('actions.merge', { source: action.sourceGroupId, target: action.targetGroupId })
    case 'rename':
      return t('actions.rename', { name: action.newName })
    case 'delete':
      return t('actions.delete', { id: action.groupId })
    case 'reorder':
      return t('actions.reorder', { ids: action.groupIds.join(', ') })
  }
}

const TYPE_VARIANT: Record<ReorganizeAction['type'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  merge: 'default',
  rename: 'secondary',
  delete: 'destructive',
  reorder: 'outline',
}

export function OrganizeProposal({ runId, token, supabaseToken, encrypted = false }: Props) {
  const [actions, setActions] = useState<ReorganizeAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [submitting, setSubmitting] = useState(false)
  const t = useTranslations('organize')

  useEffect(() => {
    if (encrypted) return
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
              // ponytail: filter renames-to-"Now Open" as a safety net; applyChanges
              // already guards the permanent group server-side.
              setActions(parsed.filter((a) => !(a.type === 'rename' && a.newName === 'Now Open')))
            }
          } catch {
            // incomplete JSON — keep buffering
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('unknownError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    stream()
    return () => { cancelled = true }
  }, [runId, supabaseToken, encrypted, t])

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
      setError(e instanceof Error ? e.message : t('submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (encrypted) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-amber-900">
          {t('encrypted')}
        </CardContent>
      </Card>
    )
  }

  if (status === 'approved') {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-6 text-sm text-green-800">
          {t('applied')}
        </CardContent>
      </Card>
    )
  }

  if (status === 'rejected') {
    return (
      <Card className="border-muted">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {t('cancelled')}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {loading && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {t('analyzing')}
          </div>
        )}

        {!loading && !error && actions.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('noChanges')}</p>
        )}

        {actions.length > 0 && (
          <ul className="flex flex-col gap-2">
            {actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge variant={TYPE_VARIANT[action.type]} className="mt-0.5 shrink-0 capitalize">
                  {t(`types.${action.type}`)}
                </Badge>
                <span>{actionLabel(action, t)}</span>
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
              {t('approve')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDecision(false)}
              disabled={submitting}
            >
              {t('reject')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
