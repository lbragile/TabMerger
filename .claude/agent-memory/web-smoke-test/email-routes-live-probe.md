---
name: email-routes-live-probe
description: How to live-test the Resend-backed support routes (/api/contact, /api/uninstall-feedback) without ever sending mail, and a chrome-devtools fill("") gotcha
metadata:
  type: reference
---

- **[2026-10]** To probe the support-email routes against a real `next start`, launch with
  `RESEND_API_KEY= RESEND_BASE_URL=http://127.0.0.1:9 npx next start -p 3100`. The empty key
  makes `new Resend()` throw "Missing API key" (caught in `sendSupportEmail`, answered as a generic
  500 `{ok:false}` and logged as `[<tag>] send failed { name: 'Error' }`). The dead base URL is the
  second guard: if Next ever loaded a real key from `.env.local`, the request still cannot reach
  Resend. Give each curl a distinct `x-forwarded-for`, since both routes rate-limit 5/hour per IP
  and the limiter counts rejected requests too.
- **[2026-10]** chrome-devtools `fill(uid, "")` clears the DOM value without firing React's
  `onChange`, so a controlled input keeps its old state (e.g. a stale invalid email keeps the form
  from submitting). That is a tool artifact, not an app bug: clear with the native value setter plus
  an `input` event in `evaluate_script`, or fill a new non-empty value.
