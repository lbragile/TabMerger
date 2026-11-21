---
name: windows-shell-edit-scripts
description: On this Windows/Git Bash setup, regex-heavy edits through bash heredocs or `python -c` get their backslashes eaten (\b became a backspace byte); write edit scripts to a scratch file instead
metadata:
  type: reference
---

Inline `python - <<'EOF'` scripts with non-raw strings turned `\b` into a literal backspace (0x08)
in a generated `.mjs` regex, and `\d`/`\.` disappeared from a `node -e "..."` script (bash double
quotes). The broken file still parsed, so it failed only at runtime. A later
`perl -pi` fix silently didn't apply. What works: write the edit script with the Write tool to the
scratchpad and run it (`python file.py`, `node file.mjs`), use raw strings for regexes, and check the
result with `cat -A` (control characters show as `^H`). Python's `print` of non-ASCII text needs
`PYTHONIOENCODING=utf-8` (cp1252 console).
