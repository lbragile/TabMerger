import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Layers, Globe, Clock, FileStack, Sparkles } from 'lucide-react'
import { BuyCreditsButton } from '@/components/account/BuyCreditsButton'

interface StatsOverviewProps {
  tabCount: number
  groupCount: number
  sessionCount: number
  memberSince: string
  aiUsage?: { used: number; limit: number }
  /**
   * Whether to show the stats that depend on synced data (tabs/groups/sessions/memory).
   * Free (and non-entitled paid-tier) accounts never sync, so groupCount/sessionCount/tabCount
   * are always 0 for them — showing those cards would look like a bug, not an empty state.
   * Derive with `hasCloudSync` from `@/lib/cloudSync`. Defaults to true to preserve existing
   * (Pro) behavior for any caller that hasn't been updated.
   */
  showSyncStats?: boolean
}

// ponytail: heuristic MB-per-tab figure, not a measurement — Chrome doesn't expose real
// per-tab memory to a web app. ~4.2MB/tab is a rough average from public browser-memory studies.
const MB_PER_TAB = 4.2

function formatMemory(tabCount: number) {
  const mb = tabCount * MB_PER_TAB
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

export function StatsOverview({
  tabCount,
  groupCount,
  sessionCount,
  memberSince,
  aiUsage,
  showSyncStats = true,
}: StatsOverviewProps) {
  const stats = [
    ...(showSyncStats
      ? [
          {
            label: 'Tabs saved',
            value: tabCount,
            icon: FileStack,
            description: 'Tabs across all synced groups',
          },
          {
            label: 'Groups synced',
            value: groupCount,
            icon: Layers,
            description: 'Groups synced in cloud',
          },
          {
            label: 'Sessions stored',
            value: sessionCount,
            icon: Clock,
            description: 'Browsing sessions stored',
          },
          {
            label: 'Memory reclaimed',
            value: formatMemory(tabCount),
            icon: Globe,
            description: 'Estimated, not measured',
          },
        ]
      : []),
    {
      label: 'Member Since',
      value: new Date(memberSince).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      }),
      icon: Globe,
      description: 'Account created',
    },
    ...(aiUsage
      ? [
          {
            label: 'AI credits this month',
            value: `${aiUsage.used}/${aiUsage.limit}`,
            icon: Sparkles,
            description: 'Pro AI monthly usage',
          },
        ]
      : []),
  ]

  // Free accounts only ever have 1-2 cards (Member Since, optionally AI usage — though AI
  // usage is pro_ai-only in practice). The full 3-column grid leaves a visibly broken
  // half-empty row for that few cards, so cap the grid width and let it size to content.
  const gridClassName = showSyncStats
    ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
    : 'grid grid-cols-1 sm:grid-cols-2 gap-4 sm:max-w-md'

  return (
    <div className={gridClassName}>
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
                {stat.label === 'AI credits this month' && aiUsage && aiUsage.used >= aiUsage.limit && (
                  <>
                    {' · '}
                    <BuyCreditsButton />
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
