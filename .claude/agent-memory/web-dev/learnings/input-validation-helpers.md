---
name: input-validation-helpers
description: Which helper validates which kind of user-supplied value in the web app (URLs to open, redirect paths, JSON bodies), and the test traps each one brings
metadata:
  type: reference
---

One helper per kind of value; reuse them instead of writing a local check.

- **URL that will be opened or linked** (stored tabs, shared bundles): `toHttpUrl` from
  `@tabmerger/shared` (`packages/shared/src/utils/url.ts`). It returns the *parsed* form, so
  `https://a.com` becomes `https://a.com/`. Open the return value, and expect the trailing
  slash in `window.open` assertions. `isScriptUrl` sits next to it for callers that need a
  yes/no on `javascript:`/`data:`/`vbscript:`/`blob:`.
- **Redirect destination from a query string** (`next`, `redirectTo`): `safeRedirectPath` in
  `lib/utils.ts`. Returns the input unchanged or `/dashboard`.
- **JSON body of a route**: `await req.json().catch(() => null)`, then a zod schema or an
  object check, so a body that is not JSON (or is `null`, a string, an array) gets a 400 and
  not a thrown 500. zod 4's `z.number()` already rejects `NaN` and `Infinity`.
- **Lookup in an object literal keyed by a query value**: test with `hasOwnProperty` first.
  `MAP['toString']` is a function, and `useState(fn)` calls it as a lazy initialiser.

Test notes:
- Avoid control characters inside regex literals (ESLint `no-control-regex`); loop over
  `charCodeAt` instead. `\t`, `\n`, `\r` escapes are allowed.
- Glob `__tests__/` for an existing file before creating a test file: several pages have a
  second, separately named test file (for example a `-topic` one) because of mock isolation.
