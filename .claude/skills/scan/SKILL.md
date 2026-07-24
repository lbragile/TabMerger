---
name: scan
description: Run pnpm scan-secrets on staged files and report findings in the conversation
disable-model-invocation: true
---

Run `pnpm scan-secrets` from the repo root.

- If it exits 0: report "No secrets found in staged files."
- If it exits non-zero: show the full output and recommend unstaging the flagged files before committing.
