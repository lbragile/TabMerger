---
name: rtl-findby-hangs-on-duplicate-text
description: screen.findByText hangs for the full test timeout (not a fast throw) when the text matches more than one element, e.g. shadcn Select's visible span + its hidden native <select><option>
metadata:
  type: feedback
---

`screen.findByText('X')` / `findByRole` wraps `getByText` in `waitFor`, which retries on
*any* thrown error — including Testing Library's "found multiple elements" error. If the
text is genuinely rendered twice (e.g. shadcn/ui `Select` renders the selected label both
in the visible trigger `<span>` and in a visually-hidden native `<select><option selected>`
for form semantics), `findByText` throws "multiple elements" on every poll and never
resolves — the test hangs until the full Vitest test timeout (default 5000ms) rather than
failing fast. It looks like an infinite render loop or a broken mock, not a query problem.

**Why:** hit this adding `?topic=` preselection tests for the Contact page's Select
(`packages/web/app/(marketing)/contact/page.tsx`) — `findByText('Beta bug report')` timed
out with no other clue. `screen.debug()` showed the text was fine, just present twice.

**How to apply:** when a `findByText`/`findByRole` assertion times out (not throws) against
a shadcn `Select`, `RadioGroup`, or anything with a parallel hidden-native-input mirror,
scope the query — e.g. `(await screen.findByRole('combobox', {name: /label/i})).toHaveTextContent('X')`
— instead of matching the bare text globally. Also: isolate tests that swap
`vi.mock('next/navigation')`'s `useSearchParams` per-test into their own file. Co-locating
them with a file that already relies on the global `vitest.setup.tsx` mock for the same
module caused renders to hang too (root cause not fully isolated — moving to a dedicated
file with a `vi.hoisted` mutable value made it reliable, and matches the existing
`sign-in/page.tsx` `Suspense`-wrapped-`useSearchParams` pattern this codebase already uses
for client pages that need a query param).
