"""PreToolUse hook: block edits to CI workflow files. These gate what ships — edit only with explicit user confirmation."""
import sys
import json
import os

d = json.load(sys.stdin)
p = d.get("file_path", "").replace(os.sep, "/")

if ".github/workflows/" in p and p.endswith((".yml", ".yaml")):
    sys.stderr.write(f"Blocked: {p} is a CI workflow file — confirm with the user before editing, then edit manually or ask them to approve explicitly.\n")
    sys.exit(1)

sys.exit(0)
