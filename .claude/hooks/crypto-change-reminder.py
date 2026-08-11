"""PostToolUse hook: non-blocking reminder when editing the shared crypto primitives.
packages/shared/src/crypto/index.ts is the single point every E2E encryption guarantee
in TabMerger depends on (groups, sessions, device sessions, public shares all route
through it). A silent regression here is much higher-blast-radius than a typical file -
nudge toward the integration test that actually proves ciphertext-at-rest, not just that
encrypt/decrypt round-trips.
"""
import sys
import json
import os

d = json.load(sys.stdin)
p = d.get("file_path", "").replace(os.sep, "/")

if p.endswith("packages/shared/src/crypto/index.ts"):
    sys.stderr.write(
        "Reminder: packages/shared/src/crypto/index.ts changed - every encrypted table "
        "(groups, sessions, device_sessions, shared_bundles) depends on this file. Re-run "
        "packages/shared/src/__tests__/crypto.test.ts and, if practical, "
        "packages/extension/src/__tests__/integration/encryption.integration.test.ts "
        "(needs a local Supabase stack via `supabase start`) before considering this done.\n"
    )

sys.exit(0)
