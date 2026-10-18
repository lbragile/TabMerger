import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Layers, Globe, Clock, FileStack, Sparkles } from 'lucide-react'
import { BuyCreditsButton } from '@/components/account/BuyCreditsButton'

interface StatsOverviewProps {
  tabCount: number
  groupCount: number
  sessionCount: number
  /**
   * Replaces the sessions card's number and description with client-rendered content, for a
   * count that is only known in the browser (see `SessionsStat`). `sessionCount` is then unused.
   */
  sessionStat?: { value: React.ReactNode; description: React.ReactNode }
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

/** "123 MB", "1.2 GB" in the active locale. */
function formatMemory(format: ReturnType<typeof useFormatter>, tabCount: number) {
  const mb = tabCount * MB_PER_TAB
  if (mb >= 1024) {
    return format.number(mb / 1024, { style: 'unit', unit: 'gigabyte', minimumFractionDigits: 1, maximumFractionDigits: 1 })
  }
  return format.number(Math.round(mb), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 })
}

export function StatsOverview({
  tabCount,
  groupCount,
  sessionCount,
  sessionStat,
  memberSince,
  aiUsage,
  showSyncStats = true,
}: StatsOverviewProps) {
  const t = useTranslations('dashboard.stats')
  const format = useFormatter()
  const locale = useLocale()
  const stats = [
    ...(showSyncStats
      ? [
          {
            id: 'tabs',
            label: t('tabs.label'),
            value: tabCount,
            icon: FileStack,
            description: t('tabs.description'),
          },
          {
            id: 'groups',
            label: t('groups.label'),
            value: groupCount,
            icon: Layers,
            description: t('groups.description'),
          },
          {
            id: 'sessions',
            label: t('sessions.label'),
            value: sessionStat?.value ?? sessionCount,
            icon: Clock,
            description: sessionStat?.description ?? t('sessions.description'),
          },
          {
            id: 'memory',
            label: t('memory.label'),
            value: formatMemory(format, tabCount),
            icon: Globe,
            description: t('memory.description'),
          },
        ]
      : []),
    {
      id: 'memberSince',
      label: t('memberSince.label'),
      value: new Date(memberSince).toLocaleDateString(locale, {
        month: 'short',
        year: 'numeric',
      }),
      icon: Globe,
      description: t('memberSince.description'),
    },
    ...(aiUsage
      ? [
          {
            id: 'aiCredits',
            label: t('aiCredits.label'),
            value: t('aiCredits.value', { used: aiUsage.used, limit: aiUsage.limit }),
            icon: Sparkles,
            description: t('aiCredits.description'),
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
          <Card key={stat.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
                {stat.id === 'aiCredits' && aiUsage && aiUsage.used >= aiUsage.limit && (
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
