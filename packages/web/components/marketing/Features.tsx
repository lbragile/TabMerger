import {
  Layers,
  Search,
  Zap,
  Cloud,
  Brain,
  Download,
  GripVertical,
  Keyboard,
} from 'lucide-react'

const features = [
  {
    icon: Layers,
    title: 'Smart Tab Grouping',
    description:
      'Organize tabs into named, color-coded groups. Keep related content together and reduce clutter instantly.',
  },
  {
    icon: Search,
    title: 'Instant Search',
    description:
      'Find any tab across all your groups with blazing-fast fuzzy search. No more hunting through dozens of tabs.',
  },
  {
    icon: Zap,
    title: 'Memory Saver',
    description:
      'Suspend tabs you aren\'t using to free up RAM. TabMerger can save hundreds of megabytes of memory.',
  },
  {
    icon: Cloud,
    title: 'Cloud Sync',
    description:
      'Sign in to sync your groups across all your devices. Your tabs are always where you need them. (Pro)',
  },
  {
    icon: Brain,
    title: 'AI Auto-Grouping',
    description:
      'Let AI analyze your open tabs and automatically group them into logical categories in seconds. (Pro AI)',
  },
  {
    icon: Download,
    title: 'Import & Export',
    description:
      'Save your tab collections as JSON and share them with your team or restore them later.',
  },
  {
    icon: GripVertical,
    title: 'Drag & Drop',
    description:
      'Reorder tabs and groups with intuitive drag-and-drop. Build the perfect tab layout your way.',
  },
  {
    icon: Keyboard,
    title: 'Keyboard Shortcuts',
    description:
      'Power user? Control everything with keyboard shortcuts. Navigate, open, and close tabs at the speed of thought. (Pro)',
  },
]

export function Features() {
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
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={feature.title}
                className="flex flex-col gap-3 rounded-lg border bg-background p-6"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
