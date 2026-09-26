# Publishing Guide

> This file is the *setup* reference (one-time secrets, store accounts). For the
> step-by-step process of actually cutting a release, see
> [`docs/RELEASE_SANITY_CHECK.md`](RELEASE_SANITY_CHECK.md) and the
> `.claude/skills/release-checklist` skill — they reflect the current pipeline and
> supersede anything below that conflicts.

## Automated pipeline (current shape)

- Version numbers are managed by **semantic-release** (`.releaserc.json`), not by hand-editing
  `packages/extension/package.json`. `package.json`'s version is never bumped by CI — the git
  tag is the sole source of truth for what ships.
- Releases are cut only from the `beta` branch (a semantic-release prerelease branch). The
  default branch, `agentic-revamp`, runs every CI gate on every push but does **not** release.
- Commit scopes `ci`, `release`, `publish`, `e2e`, `demo`, `dev`, and `web` never trigger a
  release, regardless of commit type. A commit body line starting with `BREAKING CHANGE:`
  (with the colon) always forces a major release, even in an otherwise-suppressed scope.
- A tag on `beta` fires `.github/workflows/publish.yml`, which builds the extension via WXT and
  publishes to the **private BETA Chrome Web Store item only** — a separate listing from the
  public stable one. Firefox and Edge stable publishing, and the public Chrome listing, are
  wired into the same workflow but only run for a non-prerelease `release` event.
- `packages/extension/scripts/manifestVersion.ts` maps the semver tag onto MV3's numeric
  `manifest.version` + free-form `version_name` — MV3 rejects a prerelease suffix in `version`
  outright. The beta channel's mapped major is intentionally offset by
  `BETA_STORE_MAJOR_OFFSET` (see that file for why — an accidental early release permanently
  raised the floor on the BETA item's accepted version numbers).
- `.github/workflows/deploy-web.yml` deploys a Vercel **preview** (not production) of
  `packages/web`, called from `ci.yml` after CI passes on `agentic-revamp`, aliased to a fixed
  `tabmerger-preview.vercel.app` URL.

Read the workflow files themselves for the authoritative, heavily-commented behavior — a lot of
non-obvious constraints (artifact glob patterns, `include-hidden-files`, publisher IDs, etc.)
are documented inline there and are easy to get stale in a separate doc.

---

## Prerequisites: one-time setup

### Step 1 — Chrome Web Store

1. Sign in to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. There are **two listings**: the public stable item and a separate private BETA item (own
   name, own ID). Note both Extension IDs.
3. Go to the [Google API Console](https://console.developers.google.com/) → create OAuth 2.0
   credentials, then run the auth flow to get a refresh token (`chrome-webstore-upload-cli`'s
   auth helper: `npx chrome-webstore-upload-cli@4 --help`).
4. Add to GitHub Secrets:
   - `CHROME_EXTENSION_ID` (stable listing)
   - `CHROME_BETA_EXTENSION_ID` (beta listing)
   - `CHROME_CLIENT_ID`
   - `CHROME_CLIENT_SECRET`
   - `CHROME_REFRESH_TOKEN`
   - `CHROME_PUBLISHER_ID` (the developer account ID — the segment after `/devconsole/` in the
     dashboard URL, **not** an extension ID; same value for both listings)

### Step 2 — Firefox AMO

1. Sign in to the [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/).
2. **API credentials** → generate an API key + secret.
3. Add to GitHub Secrets: `FIREFOX_API_KEY`, `FIREFOX_API_SECRET`.

### Step 3 — Edge Add-ons

1. Sign in to [Microsoft Partner Center](https://partner.microsoft.com/dashboard).
2. Note the extension's **Product ID**.
3. Generate an API access token via the Partner Center API.
4. Add to GitHub Secrets: `EDGE_PRODUCT_ID`, `EDGE_ACCESS_TOKEN`.

### Step 4 — Vercel

1. Install the Vercel CLI: `npm install -g vercel`.
2. Run `vercel link` from `packages/web/`.
3. Add to GitHub Secrets: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.
   (`VERCEL_PROJECT_ID` starts with `prj_`; don't swap the two IDs.)

### Step 5 — Supabase / web app build secrets

Both beta and stable extension builds need `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` as GitHub Secrets — without them the shipped build falls back to
a placeholder Supabase URL and sign-in/sync silently fail. `VITE_WEB_APP_URL` is hard-coded in
`publish.yml` rather than a secret.

---

## Releasing (current flow)

Cutting a release is a normal conventional-commit merge to `beta` (or `agentic-revamp` for
non-release work) — there is no manual version bump or manual `git tag`. See
[`docs/RELEASE_SANITY_CHECK.md`](RELEASE_SANITY_CHECK.md) for the full pre-flight/post-flight
checklist, and `.claude/skills/release-checklist` for the automated-gate summary.

`publish.yml` also exposes a `workflow_dispatch` escape hatch to (re-)publish an already-tagged
beta version to the BETA listing only, for the case where a `release` GitHub event silently
failed to fire.

## Manual build (testing before release)

```bash
cd packages/extension

pnpm build            # Chrome MV3 → .output/chrome-mv3/
pnpm zip              # all store zips → .output/
```

Load unpacked in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select
`.output/chrome-mv3/` (or `.output/chrome-mv3-dev/` for a `pnpm dev:extension` build).

---

## Store review times (approximate)

- Chrome: 1–3 business days
- Firefox: 1–2 weeks (AMO review is manual)
- Edge: 3–7 business days

Plan releases accordingly.

## Rollback

- **Chrome**: Developer Dashboard → Versions → roll back to the previous version.
- **Firefox**: AMO doesn't support rollback — publish a patch version immediately.
- **Edge**: Partner Center → Submissions → can revert to a previous submission.

A store rollback does not revert git — follow with a revert commit so the next release doesn't
re-ship the same defect.
