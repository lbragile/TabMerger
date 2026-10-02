---
name: manifest-version-display
description: How to surface the extension's version in the popup UI, given the beta build's major-version offset
metadata:
  type: learnings
---

`chrome.runtime.getManifest()` has both `version` and `version_name`. For the beta
store item, `scripts/manifestVersion.ts` writes `version` with a `BETA_STORE_MAJOR_OFFSET`
(+1 major) so it satisfies the Chrome Web Store's monotonically-increasing version rule,
but `version_name` still carries the real semver (e.g. `3.1.0-beta.5`). Since beta testers
are told to report what they see, any UI showing the version must prefer `version_name`
and fall back to `version` — never show raw `version` unconditionally, or testers report
version `4.1.0.5` and nobody can map that to a changelog entry.

Also: `chrome.runtime.getManifest` is undefined in Vitest/jsdom by default unless a test
explicitly sets `globalThis.chrome`, so any component reading it needs a defensive
`typeof chrome !== 'undefined' && chrome.runtime?.getManifest` guard to render nothing
rather than crash — this is the normal state for most existing Settings.test.tsx cases,
not an edge case.

Implemented as a `Badge` (default/primary variant — `bg-primary text-primary-foreground`)
next to the modal's `DialogTitle` text, e.g. "Settings v3.1.0-beta.5". Badge's base
classes already include `rounded-none` and `text-xs`, matching the popup's square-corner
style without extra overrides. Added `select-text whitespace-nowrap shrink-0` on the badge
and `min-w-0` on the DialogTitle flex row so a long `-beta.N` suffix can't wrap or overflow
the fixed 800x600 popup.

See also [[learnings-modal-flex-grid-overflow]] for the popup's overflow-containment rules
this had to respect.
