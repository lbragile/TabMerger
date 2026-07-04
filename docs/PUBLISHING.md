# Publishing Guide

## Automated Pipeline

On every `git tag v*.*.*`, the `.github/workflows/publish.yml` workflow:
1. Builds Chrome, Firefox, and Edge zips via WXT
2. Publishes each to its respective store
3. Creates a GitHub Release with auto-generated notes

Vercel deploys `packages/web` automatically on every push to `master`.

---

## Prerequisites: One-Time Setup

### Step 1 — Bump version
Before tagging, update `version` in `packages/extension/package.json`.

### Step 2 — Chrome Web Store
1. Sign in to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Go to your extension → **Store listing** → note the **Extension ID**
3. Go to [Google API Console](https://console.developers.google.com/) → Create OAuth 2.0 credentials
4. Run the auth flow to get a refresh token (use the `chrome-webstore-upload-cli` auth helper: `npx chrome-webstore-upload-cli@latest --help`)
5. Add to GitHub Secrets:
   - `CHROME_EXTENSION_ID`
   - `CHROME_CLIENT_ID`
   - `CHROME_CLIENT_SECRET`
   - `CHROME_REFRESH_TOKEN`

### Step 3 — Firefox AMO
1. Sign in to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Go to **API credentials** → Generate API key + secret
3. Add to GitHub Secrets:
   - `FIREFOX_API_KEY`
   - `FIREFOX_API_SECRET`

### Step 4 — Edge Add-ons
1. Sign in to [Microsoft Partner Center](https://partner.microsoft.com/dashboard)
2. Go to your extension → note the **Product ID**
3. Generate an API access token via the Partner Center API
4. Add to GitHub Secrets:
   - `EDGE_PRODUCT_ID`
   - `EDGE_ACCESS_TOKEN`

### Step 5 — Vercel
1. Install Vercel CLI: `pnpm add -g vercel`
2. Run `vercel link` in `packages/web/`
3. Run `vercel env pull` to sync env vars
4. Add to GitHub Secrets:
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`
   - `VERCEL_TOKEN`

---

## Releasing

```bash
# 1. Bump version in packages/extension/package.json
# 2. Commit
git add packages/extension/package.json
git commit -m "chore: bump extension version to 2.1.0"
git push

# 3. Tag and push — triggers publish.yml
git tag v2.1.0
git push origin v2.1.0
```

The pipeline takes ~10-15 minutes. Monitor it in the **Actions** tab on GitHub.

---

## Manual Build (testing before release)

```bash
cd packages/extension

# Chrome
pnpm build       # outputs to .output/chrome-mv3/
pnpm zip         # creates .output/tabmerger-{version}-chrome.zip

# Firefox
pnpm build:firefox
pnpm zip:firefox

# Edge
pnpm build:edge
pnpm zip:edge
```

Load unpacked in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `.output/chrome-mv3/`

---

## Store Review Times (approximate)
- Chrome: 1-3 business days
- Firefox: 1-2 weeks (AMO review is manual)
- Edge: 3-7 business days

Plan releases accordingly — don't tag on a Friday if you need something live by Monday.

---

## Rollback
If a bad version goes live:
- **Chrome**: Developer Dashboard → Versions → Rollback to previous version
- **Firefox**: AMO doesn't support rollback — publish a patch version immediately
- **Edge**: Partner Center → Submissions → Can revert to previous submission
