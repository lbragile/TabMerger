"""PostToolUse hook: run ESLint on the owning package when an extension or web source file is edited."""
import sys
import json
import subprocess

d = json.load(sys.stdin)
p = d.get("file_path", "").replace("\\", "/")

if "packages/extension/src/" in p:
    pkg = "@tabmerger/extension"
elif "packages/web/" in p:
    pkg = "@tabmerger/web"
else:
    sys.exit(0)

r = subprocess.run(
    ["pnpm", "--filter", pkg, "lint"],
    capture_output=True,
    text=True,
)

output = (r.stdout + r.stderr).strip()
if output:
    sys.stderr.write("\n".join(output.splitlines()[-30:]) + "\n")

sys.exit(r.returncode)
