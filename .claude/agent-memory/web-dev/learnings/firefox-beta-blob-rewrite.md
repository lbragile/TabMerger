---
name: firefox-beta-blob-rewrite
description: External-destination Next.js rewrite serving the self-distributed Firefox beta .xpi/updates.json from Vercel Blob under the web app's own domain, and why it needed a proxy.ts matcher exclusion
metadata:
  type: project
---

`packages/web/next.config.ts` rewrites `/firefox-beta/:file` to a Vercel Blob store base URL
(`FIREFOX_BETA_BLOB_BASE_URL`, Preview-only env var, not a secret) so Firefox's unlisted
self-distributed beta build can auto-update via `gecko.update_url` pointed at the web app's own
domain instead of a separate host. Path/file names all come from
`packages/shared/src/constants/firefoxBeta.ts` (`FIREFOX_BETA`) — the extension build and CI's
publish step import the same constants, so this must never drift.

Non-obvious bits:
- Next's rewrite to an **external** destination (a full `https://...` URL, not a local path) acts
  as a reverse proxy and passes the upstream response's `Content-Type`/`Cache-Control` through
  largely unmodified — no need to re-set `Content-Type: application/x-xpinstall` in
  `next.config.ts` headers, as long as CI uploads the `.xpi` to Blob with that content type
  already set. Only `updates.json` got an explicit `Cache-Control: no-store` header override
  (regardless of whatever the Blob object itself was uploaded with), since a stale cached copy
  silently stops testers from ever seeing new beta builds.
- `proxy.ts`'s matcher (`packages/web/proxy.ts`) runs the Supabase session-refresh on effectively
  every request by default — had to add `firefox-beta/` to its negative-lookahead exclusion
  alongside `_next/static` etc., otherwise every `.xpi` download and every daily Firefox
  update-check would pay for a pointless cookie/session refresh on a fully public,
  unauthenticated path.
- The rewrite and the `/beta` page's install section share one gate:
  `Boolean(process.env.FIREFOX_BETA_BLOB_BASE_URL)`. The page reads it as a plain top-level
  `const` in a server component (no client/server split needed for one conditional section) — to
  test both states in Vitest, `vi.stubEnv` + `vi.resetModules()` + a dynamic `await import(...)`
  is required, since the env read happens at module-evaluation time, not render time (same pattern
  already used by `supabaseServerEnvDegradation.test.ts`).
- Validate the base URL is `https://` in the rewrite builder itself (`firefoxBetaRewrite` in
  `next.config.ts`, exported specifically so it's unit-testable) — an accidental `http://` or
  malformed value should silently disable the rewrite rather than misconfigure Next's rewrite
  table or crash the build.
