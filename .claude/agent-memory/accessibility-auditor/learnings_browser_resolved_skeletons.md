---
name: browser-resolved-skeletons
description: Audit checklist for session-dependent UI resolved in the browser (header account slot, pricing CTAs, teaser) on statically rendered pages
metadata:
  type: reference
---

When a statically rendered page resolves who is signed in on the client, check these (each was a real finding class):

- A `<noscript>` fallback must exist for every skeleton that replaces an action, not only the header. A busy skeleton with no fallback leaves no-JS visitors without the action and keeps a "Loading..." label in the tree forever.
- `aria-busy` on a plain div (no role, not a live region) does little; the sr-only label is plain static text that is read in browse mode and then silently removed. No stale busy state remains as long as the skeleton unmounts on resolve. A status change (badge Guest to Current) is only perceivable visually unless one polite status region announces it.
- `next/dynamic` without a `loading` option renders nothing while its chunk loads. If the slot is swapped from a skeleton to such a component, the slot collapses and re-expands (layout shift). Give it a `loading` skeleton of the same box, or preload the chunk.
- A size-hint script (cookie present means avatar-sized skeleton) shifts the header cluster when the cookie is stale (hint says signed in, session resolves signed out): the end cluster is `justify-end`, so the items before it move by the width difference.
- A skeleton sized from the guest label ("Get X") is shorter than the resolved label ("Upgrade to X", "Switch to yearly billing") in narrow cards at md width in long locales (pt-BR, de, ru): size it by the longest label.
- `key` on an element that goes from `undefined` to a string remounts it (state and focus lost), even when the component type is the same. Both the Pro AI pricing card (`key={currentAiMode ?? 'none'}`) and the home teaser (`<PricingTeaser key=...>` vs keyless) do this for subscribers.
- Fetches that decide whether an action appears need a timeout fallback, or a stalled request leaves the skeleton up indefinitely.
- Locales: nav/pricing `loadingAccount` / `loadingPlan` existed and read naturally in all 18 locales on 2026-11-05.
