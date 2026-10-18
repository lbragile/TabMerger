---
name: health-and-cron-probe
description: How to read /api/health and /api/cron/web-heartbeat results in a local smoke test, and how to check that the uninstall server action fires exactly once
metadata:
  type: reference
---

- **[2026-10]** `GET /api/health` returns **503 `supabase:"down"`** locally whenever the local Supabase stack (127.0.0.1:54321) isn't running. That is the intended behavior, not a regression: check `curl $SUPABASE_URL/auth/v1/health` before you flag it. `ok` is false only when Supabase is configured *and* down. With no URL or key it reports `unconfigured`, with 200.
- `/api/cron/web-heartbeat` fails closed. With no bearer, a wrong bearer or no `CRON_SECRET` it returns 401. After that it returns 503 `ga_not_configured` when the web GA4 stream env is missing.
- Checking that `/uninstalled` sends the event once: use headless Playwright and watch for a POST to the page URL that carries a `next-action` header (the server action), plus a `tm_uninstall_tracked:<search>` sessionStorage key. Reloading the page must not send a second POST.
- Playwright is only reachable from the worktree's pnpm store (`node_modules/.pnpm/@playwright+test@*/.../index.js`), so pass that path into a scratchpad script. The chrome-devtools MCP is often unavailable.
- On a local `next start`, `/_vercel/insights` and `/_vercel/speed-insights` return 404. That's expected and not a failure.

Related: [[i18n-locale-probe]]
