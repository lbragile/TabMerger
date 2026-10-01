'use client'

import { useId, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { betaAreaKeys, betaGoodKey, betaStepKey } from '@/lib/betaChecklist'

/**
 * Tester progress on /beta: which test steps they've ticked. It lives only in this browser
 * (localStorage), a per-tester convenience that nobody else sees. Every read and write is wrapped
 * because storage can be unavailable (private windows, blocked site data); the page then works
 * as a plain list and simply forgets checkmarks on reload.
 */
const STORAGE_KEY = 'tabmerger:beta-checklist:v1'
const EMPTY: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()
let cache: ReadonlySet<string> | null = null

function readChecked(): ReadonlySet<string> {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cache = new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    cache = new Set()
  }
  return cache
}

function writeChecked(next: ReadonlySet<string>) {
  cache = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Storage unavailable: keep the in-memory state for this visit.
  }
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  // Another tab ticked something: re-read so both tabs agree.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null
      notify()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(notify)
    window.removeEventListener('storage', onStorage)
  }
}

/** The ticked step keys. Empty on the server and on the first client render (no mismatch). */
function useCheckedSteps() {
  return useSyncExternalStore(subscribe, readChecked, () => EMPTY)
}

function toggle(key: string) {
  const next = new Set(readChecked())
  if (next.has(key)) next.delete(key)
  else next.add(key)
  writeChecked(next)
}

/** One item's numbered steps, each with a checkbox. Ticked steps are struck through. */
export function BetaStepList({ areaId, steps }: { areaId: string; steps: string[] }) {
  const checked = useCheckedSteps()
  const baseId = useId()
  return (
    <ol className="space-y-1 text-muted-foreground mb-3">
      {steps.map((step, i) => {
        const key = betaStepKey(areaId, step)
        const done = checked.has(key)
        const id = `${baseId}-${i}`
        return (
          <li key={key} className="flex items-start gap-2">
            <input
              id={id}
              type="checkbox"
              checked={done}
              onChange={() => toggle(key)}
              className="mt-[0.2rem] h-4 w-4 shrink-0 cursor-pointer accent-primary"
            />
            <label htmlFor={id} className={cn('cursor-pointer', done && 'line-through opacity-60')}>
              <span className="tabular-nums">{i + 1}.</span> {step}
            </label>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * An item's "Good looks like" outcomes, each with a checkbox, so testers confirm every result they
 * saw (not just that they did the steps). Struck through once ticked, like a step.
 */
export function BetaGoodCheck({ areaId, good }: { areaId: string; good: string[] }) {
  const checked = useCheckedSteps()
  const baseId = useId()
  return (
    <div className="text-muted-foreground">
      <p className="font-medium text-foreground/80 mb-1.5">Good looks like</p>
      <ul className="space-y-1">
        {good.map((outcome, i) => {
          const key = betaGoodKey(areaId, outcome)
          const done = checked.has(key)
          const id = `${baseId}-${i}`
          return (
            <li key={key} className="flex items-start gap-2">
              <input
                id={id}
                type="checkbox"
                checked={done}
                onChange={() => toggle(key)}
                className="mt-[0.2rem] h-4 w-4 shrink-0 cursor-pointer accent-primary"
              />
              <label htmlFor={id} className={cn('cursor-pointer', done && 'line-through opacity-60')}>
                {outcome}
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** "3/12" (or "✓ All done") for a test area, shown in its collapsed header. */
export function BetaAreaProgress({ areaId, items }: { areaId: string; items: { steps: string[]; good: string[] }[] }) {
  const checked = useCheckedSteps()
  const keys = betaAreaKeys(areaId, items)
  const done = keys.filter((key) => checked.has(key)).length
  if (done === 0) return null
  const all = done === keys.length
  return (
    <span
      className={cn('ml-auto mr-3 text-xs tabular-nums', all ? 'text-ok font-medium' : 'text-muted-foreground')}
      aria-label={all ? 'All checks done' : `${done} of ${keys.length} checks done`}
    >
      {all ? '✓ All done' : `${done}/${keys.length}`}
    </span>
  )
}

/** Clears every checkmark on the page, e.g. to test a new release from scratch. */
export function BetaChecklistReset() {
  const checked = useCheckedSteps()
  if (checked.size === 0) return null
  return (
    <button
      type="button"
      onClick={() => writeChecked(new Set())}
      className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      Clear my checkmarks ({checked.size})
    </button>
  )
}
