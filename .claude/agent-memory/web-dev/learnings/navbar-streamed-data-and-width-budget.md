---
name: navbar-streamed-data-and-width-budget
description: Streaming slow data into the Navbar with an un-awaited promise + use(), sharing it with a client component, and the header's width budget between md and lg
metadata:
  type: reference
---

**Streaming into the Navbar.** Start the fetch in `Navbar` without awaiting it and pass the
promise down; the consumer calls `use(promise)` inside `<Suspense>`. Reasons this beats an
`async` child component here:

- The same promise can go to a server component (the bar's badge) and to a client component
  (`MobileNavToggle`) as a prop, so there is one request and no client-side fetch.
- `Navbar.test.tsx` renders with `render(await Navbar())`, a client render. A non-async
  component using `use()` works there; mocking the data module (`@/lib/githubStats`) is the
  only test change needed.

**fetch notes (Next 16, no `cacheComponents`).** `next: { revalidate }` on `fetch` is the data
cache. Passing a `signal` (e.g. `AbortSignal.timeout`) only opts the call out of per-render
request memoization, not out of the data cache, so call it once per render and share the
promise. Only 200 responses are stored, so failures are retried on the next request.

**Header width budget.** The `container` is capped at 768px for every viewport from 768 to
1023, and at exactly 768 its content box is only 688px (header `px-4` plus container
padding). The logged-out bar (logo, four nav links, GitHub mark, theme toggle, Sign in, Get
started) fits there only because of the tighter spacing below `lg` (`mr-4` on the logo and
the left block, `px-2` on the nav links).

**`scrollWidth` does not catch a too-wide bar.** The left block is a shrinkable flex item
and the right block is `flex-1 justify-end`, so when the content is too wide the right-hand
cluster slides left over the last nav link and into the container's right padding;
`scrollWidth === clientWidth` still holds. Measure element rects instead: the smallest gap
between neighbouring visible links/buttons (must stay positive, FAQ to the first control
especially) and the last control's right edge against the container's content box. Check
768, 800 and 1023 logged out, not only phone widths.

Decision: the GitHub badge is hidden below `sm` (the mobile panel has a row), full from
`sm`, a mark-only square from `md` to `lg`, full again from `lg`. Badge, theme toggle and the
`size="sm"` buttons share `h-9`, `rounded-md` and (badge and toggle) `border-border2`.
