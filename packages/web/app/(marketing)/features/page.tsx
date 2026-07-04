import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Layers,
  Search,
  Zap,
  Cloud,
  Brain,
  Download,
  GripVertical,
  Keyboard,
  RefreshCw,
  Shield,
  Chrome,
  ArrowRight,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Explore everything TabMerger can do — from smart tab grouping to AI-powered organization.',
}

const featureSections = [
  {
    badge: 'Core',
    title: 'Powerful tab management',
    description:
      'The foundation of TabMerger: fast, intuitive tab organization that fits any workflow.',
    features: [
      {
        icon: Layers,
        title: 'Named & color-coded groups',
        description:
          'Create groups with custom names and colors. Visually separate work, research, entertainment, and more at a glance.',
      },
      {
        icon: Search,
        title: 'Full-text search',
        description:
          'Search across all your tab titles and URLs instantly. Fuzzy matching means you find what you need even with typos.',
      },
      {
        icon: GripVertical,
        title: 'Drag-and-drop reordering',
        description:
          'Rearrange tabs within groups and reorder groups themselves with smooth drag-and-drop interactions.',
      },
      {
        icon: Download,
        title: 'Import & export',
        description:
          'Export your tab collections as JSON to share with teammates or back up your workspace. Import them on any device.',
      },
      {
        icon: Zap,
        title: 'Memory savings',
        description:
          'Suspend inactive tabs to free RAM. See exactly how much memory TabMerger is saving you in real time.',
      },
    ],
  },
  {
    badge: 'Pro',
    badgeVariant: 'default' as const,
    title: 'Sync & sessions',
    description:
      'Pick up exactly where you left off, on any device, any time.',
    features: [
      {
        icon: Cloud,
        title: 'Cloud sync',
        description:
          'Your groups are automatically saved and synced across every browser you sign into. Real-time, no manual export needed.',
      },
      {
        icon: RefreshCw,
        title: 'Session save & restore',
        description:
          'Snapshot your current groups as a named session. Restore them instantly after a restart or when you need to context-switch.',
      },
      {
        icon: Keyboard,
        title: 'Keyboard shortcuts',
        description:
          'Every action has a keyboard shortcut. Create groups, move tabs, open sessions — all without touching the mouse.',
      },
      {
        icon: Shield,
        title: 'Priority support',
        description:
          'Pro subscribers get fast-tracked support with a guaranteed response within 24 hours.',
      },
    ],
  },
  {
    badge: 'Pro AI',
    badgeVariant: 'default' as const,
    title: 'AI-powered organization',
    description:
      'Let Claude analyze your tabs and make smart suggestions so you can focus on thinking, not filing.',
    features: [
      {
        icon: Brain,
        title: 'Auto-grouping',
        description:
          'Open a mess of tabs, click one button. AI clusters them into logical groups based on topic, domain, and intent.',
      },
      {
        icon: Layers,
        title: 'Smart group names',
        description:
          'AI suggests concise, descriptive names for your groups. One click to accept, or type your own.',
      },
      {
        icon: Search,
        title: 'Tab summaries',
        description:
          'Hover any tab to see a one-sentence AI summary of what the page is about — without opening it.',
      },
      {
        icon: RefreshCw,
        title: 'Session suggestions',
        description:
          'AI analyzes your browsing patterns and suggests how to structure sessions for maximum productivity.',
      },
    ],
  },
]

export default function FeaturesPage() {
  return (
    <div className="py-16">
      <div className="container">
        {/* Header */}
        <div className="text-center mb-20">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Features built for focus
          </h1>
          <p className="mt-4 text-xl text-muted-foreground max-w-2xl mx-auto">
            Everything you need to take control of your browser — from free
            essentials to pro AI superpowers.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="gap-2" asChild>
              <a
                href="https://chrome.google.com/webstore"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Chrome className="h-5 w-5" />
                Add to Chrome — It&apos;s Free
              </a>
            </Button>
            <Button variant="outline" size="lg" className="gap-2" asChild>
              <Link href="/pricing">
                See pricing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Feature sections */}
        <div className="flex flex-col gap-24">
          {featureSections.map((section) => (
            <div key={section.title}>
              <div className="mb-10">
                <Badge variant={section.badgeVariant ?? 'secondary'} className="mb-3">
                  {section.badge}
                </Badge>
                <h2 className="text-3xl font-bold tracking-tight">
                  {section.title}
                </h2>
                <p className="mt-2 text-lg text-muted-foreground max-w-xl">
                  {section.description}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {section.features.map((feature) => {
                  const Icon = feature.icon
                  return (
                    <div
                      key={feature.title}
                      className="flex flex-col gap-3 rounded-xl border bg-background p-6"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <h3 className="font-semibold">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
