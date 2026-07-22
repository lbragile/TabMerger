"""PostToolUse hook: run Vitest when a test file is edited."""
import sys
import json
import subprocess
import os

d = json.load(sys.stdin)
p = d.get("file_path", "").replace(os.sep, "/")

if "__tests__/" not in p and ".test." not in p and ".spec." not in p:
    sys.exit(0)

# Determine which package owns the file
if "packages/extension/" in p:
    filter_pkg = "@tabmerger/extension"
elif "packages/web/" in p:
    filter_pkg = "@tabmerger/web"
else:
    sys.exit(0)

r = subprocess.run(
    ["pnpm", "--filter", filter_pkg, "test", "--run"],
    capture_output=True,
    text=True,
)

output = (r.stdout + r.stderr).strip()
if output:
    sys.stderr.write("\n".join(output.splitlines()[-30:]) + "\n")

sys.exit(r.returncode)
