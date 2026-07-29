'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useExtensionInstalled } from '@/lib/hooks/useExtensionInstalled'

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
  const extensionInstalled = useExtensionInstalled()

  const steps: Step[] = [
    {
      id: 'install',
      label: 'Install the TabMerger extension',
      href: 'https://chromewebstore.google.com/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc',
      done: extensionInstalled,
    },
    {
      id: 'group',
      label: 'Create your first group in the extension',
      href: undefined, // informational only
      // ponytail: no browser signal to verify this from the web app either — treat as
      // optimistically done so the checklist doesn't stall forever on an unverifiable step
      done: true,
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
  const doneCount = steps.filter((s) => s.done).length

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
    <div className="rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/10 px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold">Get started with TabMerger</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-blue-700 dark:text-blue-300">{doneCount} of 4 done</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={4}
        className="h-1.5 w-full rounded-full bg-blue-100 dark:bg-blue-500/20 overflow-hidden mb-3"
      >
        <div
          className="h-full rounded-full bg-blue-500 dark:bg-blue-400 transition-all"
          style={{ width: `${(doneCount / 4) * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {steps.map((step) => {
          const Icon = step.done ? CheckCircle2 : Circle
          const content = (
            <span className={`text-xs ${step.done ? 'line-through text-blue-700 dark:text-blue-300' : ''}`}>
              {step.label}
            </span>
          )
          return (
            <div key={step.id} className="flex items-center gap-1.5">
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${step.done ? 'text-green-500 dark:text-green-400' : 'text-muted-foreground'}`}
              />
              {step.href && !step.done ? (
                <a href={step.href} className="text-xs text-blue-600 dark:text-blue-300 hover:underline" target={step.href.startsWith('http') ? '_blank' : undefined} rel={step.href.startsWith('http') ? 'noopener noreferrer' : undefined}>
                  {step.label}
                </a>
              ) : content}
            </div>
          )
        })}
      </div>

      {allDone && (
        <Button size="sm" className="mt-2" onClick={() => { setAllDoneSeen(true); dismiss() }}>
          Done
        </Button>
      )}
    </div>
  )
}
