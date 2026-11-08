import type { ReactNode } from 'react'

/**
 * `<code>…</code>` in a `compare` message: a code-like Latin token (`group:`, `t:`, `Ctrl/Cmd+K`,
 * `.txt`) rendered as a left-to-right isolate, so its punctuation stays put in Arabic, Hebrew and
 * Persian. With an invisible isolate mark alone, a translator could drop it unnoticed; a tag is
 * checked by the catalog test (every locale keeps every tag of the English message).
 */
export function ltrToken(chunks: ReactNode) {
  return <bdi dir="ltr">{chunks}</bdi>
}

/** The rich-text tags every `compare` message may use (pass to `t.rich`). */
export const COMPARE_RICH_TAGS = { code: ltrToken } as const
