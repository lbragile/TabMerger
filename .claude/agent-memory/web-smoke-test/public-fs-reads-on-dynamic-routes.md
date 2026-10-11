---
name: public-fs-reads-on-dynamic-routes
description: How to verify that a server component reading public/ with node:fs still works when its route is rendered on demand (every marketing route is dynamic)
metadata:
  type: reference
---

- **[2026-10]** Every `(marketing)` route, including `/`, builds as `ƒ` (dynamic), because the shared layout's Navbar reads the Supabase session cookie. A server component that reads `public/` with `node:fs` at render time (e.g. `DemoSection` building `?v=<mtime>` URLs) therefore runs inside the serverless function on Vercel, not at build time.
- It still works because Turbopack's file tracer sees `path.join(process.cwd(), 'public', <variable>)` and traces the whole `public/**` tree into that route's function. The evidence to check after a build is `packages/web/.next/server/app/(marketing)/page.js.nft.json`: the asset paths must be listed in `files`. If the path expression is changed so the tracer can no longer see it (fully computed string, helper in another module), the lookup returns null in production with no build error and the section silently renders nothing; `outputFileTracingIncludes` in `next.config.ts` is the explicit fix (the `/changelog` route already uses it).
- `next start` locally cannot catch this: `public/` is always on disk there. Only the nft.json check (or the deployed preview HTML) proves it.
- Side effect: any route whose code does this carries all of `public/` in its function bundle, so large files added to `public/` grow that function.
- For headless checks of the theme-dependent video, set `localStorage.theme` in a chrome-devtools `initScript` and wrap the `HTMLMediaElement.prototype.src` setter to log assignments; that shows whether a dark-theme visitor was ever handed the light source.
