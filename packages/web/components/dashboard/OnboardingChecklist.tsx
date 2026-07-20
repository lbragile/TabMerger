'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'tm_onboarding_dismissed'

interface Props {
  isSignedIn: boolean
  isPro: boolean
}

interface Step {
  id: string
  label: string
  href?: string
  done: boolean
}

export function OnboardingChecklist({ isSignedIn, isPro }: Props) {
  const [dismissed, setDismissed] = useState(false)
  // Read localStorage after mount — direct access in useState initializer crashes SSR
  useEffect(() => { setDismissed(localStorage.getItem(STORAGE_KEY) === '1') }, [])
  const [allDoneSeen, setAllDoneSeen] = useState(false)

  const steps: Step[] = [
    {
      id: 'install',
      label: 'Install the TabMerger extension',
      href: 'https://chromewebstore.google.com/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc',
      done: false, // ponytail: no reliable browser signal from the web app; treat as always pending
    },
    {
      id: 'group',
      label: 'Create your first group in the extension',
      href: undefined, // informational only
      done: false,
    },
    {
      id: 'signin',
      label: 'Sign in to enable cloud sync',
      href: '/auth/sign-in',
      done: isSignedIn,
    },
    {
      id: 'upgrade',
      label: 'Upgrade to Pro for unlimited groups',
      href: '/pricing',
      done: isPro,
    },
  ]

  const allDone = steps.every((s) => s.done)

  useEffect(() => {
    if (allDone && !allDoneSeen) {
      const t = setTimeout(() => {
        dismiss()
      }, 3000)
      return () => clearTimeout(t)
    }
  }, [allDone, allDoneSeen])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }

  if (dismissed) return null

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Get started with TabMerger</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {steps.map((step) => {
          const Icon = step.done ? CheckCircle2 : Circle
          const content = (
            <span className={`text-sm ${step.done ? 'line-through text-muted-foreground' : ''}`}>
              {step.label}
            </span>
          )
          return (
            <div key={step.id} className="flex items-center gap-2">
              <Icon
                className={`h-4 w-4 shrink-0 ${step.done ? 'text-green-500' : 'text-muted-foreground'}`}
              />
              {step.href && !step.done ? (
                <a href={step.href} className="text-sm text-blue-600 hover:underline" target={step.href.startsWith('http') ? '_blank' : undefined} rel={step.href.startsWith('http') ? 'noopener noreferrer' : undefined}>
                  {step.label}
                </a>
              ) : content}
            </div>
          )
        })}
        {allDone && (
          <Button size="sm" className="mt-2" onClick={() => { setAllDoneSeen(true); dismiss() }}>
            Done
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
