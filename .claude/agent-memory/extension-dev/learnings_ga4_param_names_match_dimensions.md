---
name: ga4-param-names-match-dimensions
description: Extension GA4 event params must use the exact parameter names registered as custom dimensions in docs/ANALYTICS.md (extension_version, channel), shared with the server-side uninstall event
metadata:
  type: reference
---

GA4 custom dimensions are keyed by event-parameter name, so the same concept must use the same
name on every event. The daily `extension_heartbeat` once sent `version` while the registered
"Extension version" dimension (and the server-side `extension_uninstalled` event in
`packages/web/lib/uninstallTracking.ts`) use `extension_version`; the heartbeat's version never
reached the dimension.

- Version param is `extension_version`, release channel is `channel` (`stable` / `beta`).
- `releaseChannel()` lives in `src/lib/releaseChannel.ts` (MODE `beta` → `beta`, else `stable`),
  used by both the uninstall-survey URL and the heartbeat. Tests flip it with `vi.stubEnv('MODE', 'beta')`.
- When a new param is added to an extension event, add it to the event table and (if it should be
  a breakdown) the custom-dimension table in `docs/ANALYTICS.md`, and check the privacy page's
  list of what events carry (`packages/web/app/[locale]/(marketing)/privacy/page.tsx`, asserted in
  `packages/web/__tests__/privacy-page.test.tsx`).

Related: [[ga4-event-wiring]], [[uninstall-survey-url]]
