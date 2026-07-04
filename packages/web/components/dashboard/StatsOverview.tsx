import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Layers, Globe, Clock } from 'lucide-react'

interface StatsOverviewProps {
  groupCount: number
  sessionCount: number
  memberSince: string
}

export function StatsOverview({
  groupCount,
  sessionCount,
  memberSince,
}: StatsOverviewProps) {
  const stats = [
    {
      label: 'Tab Groups',
      value: groupCount,
      icon: Layers,
      description: 'Groups synced in cloud',
    },
    {
      label: 'Sessions Saved',
      value: sessionCount,
      icon: Clock,
      description: 'Browsing sessions stored',
    },
    {
      label: 'Member Since',
      value: new Date(memberSince).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      }),
      icon: Globe,
      description: 'Account created',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
