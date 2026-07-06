import Link from 'next/link'
import { ArrowRight, Layers, Search, Zap, Download, Cloud, Brain, GripVertical, Keyboard } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tier = 'core' | 'pro' | 'pro_ai'

const tierPill: Record<Tier, { label: string; className: string }> = {
  core:   { label: 'Core',   className: 'bg-muted text-muted-foreground' },
  pro:    { label: 'Pro',    className: 'bg-primary/10 text-primary' },
  pro_ai: { label: 'Pro AI', className: 'bg-secondary/10 text-secondary' },
}

const features: { icon: React.ElementType; title: string; description: string; tier: Tier }[] = [
  {
    icon: Layers,
    title: 'Smart Tab Grouping',
    description: 'Organize tabs into named, color-coded groups. Keep related content together and reduce clutter instantly.',
    tier: 'core',
  },
  {
    icon: Search,
    title: 'Instant Search',
    description: 'Find any tab across all your groups with blazing-fast fuzzy search. No more hunting through dozens of tabs.',
    tier: 'core',
  },
  {
    icon: Zap,
    title: 'Memory Saver',
    description: 'Suspend tabs you aren\'t using to free up RAM. TabMerger can save hundreds of megabytes of memory.',
    tier: 'core',
  },
  {
    icon: Download,
    title: 'Import & Export',
    description: 'Save your tab collections as JSON and share them with your team or restore them later.',
    tier: 'core',
  },
  {
    icon: Cloud,
    title: 'Cloud Sync',
    description: 'Sync your groups across all your devices automatically. Your tabs are always where you need them.',
    tier: 'pro',
  },
  {
    icon: GripVertical,
    title: 'Drag & Drop',
    description: 'Reorder tabs and groups with intuitive drag-and-drop. Build the perfect tab layout your way.',
    tier: 'core',
  },
  {
    icon: Brain,
    title: 'AI Auto-Grouping',
    description: 'Let AI analyze your open tabs and automatically group them into logical categories in seconds.',
    tier: 'pro_ai',
  },
  {
    icon: Keyboard,
    title: 'Keyboard Shortcuts',
    description: 'Control everything with keyboard shortcuts. Navigate, open, and close tabs at the speed of thought.',
    tier: 'pro',
  },
]

const PREVIEW_COUNT = 4

export function Features() {
  const preview = features.slice(0, PREVIEW_COUNT)

  return (
    <section className="py-24 bg-muted/30">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to master your tabs
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            TabMerger packs powerful features into a lightweight, intuitive extension that stays out of your way.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {preview.map((feature) => {
            const Icon = feature.icon
            const pill = tierPill[feature.tier]
            return (
              <div
                key={feature.title}
                className="group flex flex-col gap-3 rounded-lg border bg-background p-6 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 transition-colors group-hover:bg-primary/15">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', pill.className)}>
                    {pill.label}
                  </span>
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            )
          })}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/features"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            See all {features.length} features
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}
