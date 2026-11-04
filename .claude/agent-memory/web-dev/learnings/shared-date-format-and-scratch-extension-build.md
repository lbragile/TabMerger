---
name: shared-date-format-and-scratch-extension-build
description: A shared Intl.DateTimeFormatOptions constant fails next-intl's format.dateTime types unless declared `as const satisfies`; and how to build the extension for e2e outside .output/ (wxt -c wrapper config, not the build() API)
metadata:
  type: reference
---

**Shared date-format constants and next-intl.** A constant typed `: Intl.DateTimeFormatOptions` (in
`@tabmerger/shared`, so web and extension format one date alike) does not type-check as
`format.dateTime(date, OPTIONS)`: use-intl's own options type narrows `timeZoneName` to
`'long' | 'short'`, and the DOM type's wider union (`'shortOffset'`, ...) is rejected (TS2769).
Declare it `{ dateStyle: 'medium', timeZone: 'UTC' } as const satisfies Intl.DateTimeFormatOptions`:
it then fits both next-intl and `Date#toLocaleDateString`. Example: `AI_CREDITS_RESET_DATE_FORMAT`.

A fixed `timeZone` (UTC here, the zone the AI month key uses) is what keeps a server-rendered date
and the browser's equal; test it with an instant late in the UTC day (23:30Z) so a wrong zone shows.

**Extension e2e build outside `.output/`.** `wxt build` has no `--outDir` flag, and calling WXT's
`build()` JS API from a script outside the package fails with "Cannot find module 'vite'" from
`wxt.config.ts`. What works: a wrapper config in the scratch folder,
`import base from '<abs>/packages/extension/wxt.config.ts'; export default { ...base, outDir: '<scratch>/ext-e2e' }`,
then from `packages/extension`: `VITE_AI_ENABLED=true npx wxt build --mode development -c <wrapper>`
(`--mode` must stay on the command line: the config reads it from argv). Run the specs with
`TM_E2E_EXT_DIR=<scratch>/ext-e2e/chrome-mv3-dev npx playwright test ...` from `e2e/`.

**`vi.doMock` outlives `vi.resetModules()`.** A test that imports a module (say a lib constant)
before calling its own `vi.doMock` gets that module wired to the PREVIOUS test's mock: the doMock
registry is not cleared by resetModules. Register the test's mocks first, then import.

**Optional Stripe reads in a page.** When a page adds a Stripe read only to word something (the
dashboard's scheduled change for "Credits end on"), race it against a short timer and catch, so a
slow or failing read degrades to the stored row instead of holding the render (the SDK's own
timeout is long). Test the timeout with fake `setTimeout` and a never-settling mock, advancing by
the exported limit.

Related: [[deployment-dependent-links]], [[i18n-next-intl]], [[vitest-hoisted-mock-state]].
