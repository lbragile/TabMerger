"""PostToolUse hook: run tsc on the extension package when an extension source file is edited."""
import sys
import json
import subprocess
import os

d = json.load(sys.stdin)
p = d.get("file_path", "").replace(os.sep, "/")

if "packages/extension/src/" not in p:
    sys.exit(0)

r = subprocess.run(
    ["pnpm", "--filter", "@tabmerger/extension", "tsc", "--noEmit"],
    capture_output=True,
    text=True,
)

output = (r.stdout + r.stderr).strip()
if output:
    sys.stderr.write("\n".join(output.splitlines()[-20:]) + "\n")

sys.exit(r.returncode)
