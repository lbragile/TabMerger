"""PreToolUse hook: non-blocking reminder when editing a shared UI primitive.
components/ui/ files (Button, PasswordInput, Input, Dialog, ...) are consumed by many
call sites across the popup/web app - a change here has a wide blast radius. This never
blocks (always exits 0), it just nudges to check callers before saving.
"""
import sys
import json
import os

d = json.load(sys.stdin)
p = d.get("file_path", "").replace(os.sep, "/")

if "/components/ui/" in p:
    sys.stderr.write(
        f"Reminder: {p} is a shared UI primitive - grep for its call sites and check "
        "they still work (props, asChild/Slot usage, loading/disabled states) before finishing.\n"
    )

sys.exit(0)
