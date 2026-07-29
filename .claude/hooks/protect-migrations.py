"""PreToolUse hook: block edits to already-applied Supabase migration files. New migrations must be new files, never edits to history."""
import sys
import json
import os

d = json.load(sys.stdin)
p = d.get("file_path", "").replace(os.sep, "/")

if "supabase/migrations/" in p and p.endswith(".sql") and os.path.exists(p):
    sys.stderr.write(f"Blocked: {p} is an already-applied migration — create a new migration file instead of editing history.\n")
    sys.exit(1)

sys.exit(0)
