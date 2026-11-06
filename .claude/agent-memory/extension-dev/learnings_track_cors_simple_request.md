---
name: track-cors-simple-request
description: /api/track and /api/og-preview POST JSON as text/plain;charset=UTF-8 (SIMPLE_JSON_CONTENT_TYPE) so they are CORS simple requests with no OPTIONS preflight
metadata:
  type: reference
---

`trackEvent()` (`src/lib/analytics.ts`) and `getPageMetaForTab()` (`src/lib/tabAccess.ts`) send JSON
bodies with `Content-Type: text/plain;charset=UTF-8`, from the shared constant
`SIMPLE_JSON_CONTENT_TYPE` in `src/lib/simpleRequest.ts`.
The extension has no `host_permissions`, so every fetch to the web app is a cross-origin CORS request;
`application/json` (or any non-safelisted header such as `Authorization`) forces an OPTIONS preflight,
doubling the requests the web app serves. Both routes parse JSON from either content type, because
older installs keep sending `application/json`.

Rules for keeping a request preflight-free: method POST/GET/HEAD, only CORS-safelisted headers, content
type one of `text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`, and a string body.
Adding any other header (e.g. a custom version header) silently brings the preflight back. The unit
tests (`__tests__/unit/lib/analytics.test.ts`, `tabAccess.test.ts`) assert the headers object exactly
for that reason; `TabPreview.test.tsx` also asserts the og-preview fetch init.

Requests that preflight regardless: `/api/ai/*` (useAI) and `/api/portal` (Settings) send
`Authorization`. PostHog's `/capture/` stays `application/json`; it is PostHog's host, not ours.
