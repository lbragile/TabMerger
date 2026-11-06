'use client'

import { useCallback, useState } from 'react'
import type { AiMode } from '@tabmerger/shared'
import { initialAiMode } from './aiOptions'

/**
 * The Pro AI option a card shows, opening on `seed` (the subscriber's own option) via
 * `initialAiMode`. The plan listings learn the plan in the browser, after the first render, so the
 * seed can arrive late: the option follows it until the visitor uses the switch, and never after.
 * No remount, so focus and the rest of the card's state (Monthly/Yearly) stay put.
 */
export function useSeededAiMode(seed: AiMode | undefined): [AiMode, (mode: AiMode) => void] {
  const [aiMode, setAiMode] = useState<AiMode>(() => initialAiMode(seed))
  const [touched, setTouched] = useState(false)
  const [seededFrom, setSeededFrom] = useState(seed)
  // Adjusting state while rendering (React's pattern for "props changed"): no effect, no flash.
  if (seed !== seededFrom) {
    setSeededFrom(seed)
    if (!touched) setAiMode(initialAiMode(seed))
  }
  const choose = useCallback((mode: AiMode) => {
    setTouched(true)
    setAiMode(mode)
  }, [])
  return [aiMode, choose]
}
