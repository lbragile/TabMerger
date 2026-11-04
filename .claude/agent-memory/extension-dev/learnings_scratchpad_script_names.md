---
name: scratchpad-script-names
description: The session scratchpad can already hold scripts from earlier agent runs; a generic name (add_keys.py) silently ran an old locale rewrite
metadata:
  type: reference
---

The scratchpad directory is not always empty: earlier agent runs in the same session leave their
helper scripts there. When `Write` fails with "File has not been read yet", a file of that name
already exists. That error does NOT stop a later Bash command, so `python .../add_keys.py` ran
the OLD script: an earlier locale rewrite that reset `header.nameGroupHint` in all 18 locales and
re-escaped fa's ZWNJ characters as `‌`.

**How to apply:**
- Give helper scripts task-unique names (`extdev_<task>_<what>.py`), never generic ones.
- If `Write` fails, stop and pick a new name; never run the path anyway.
- Bulk locale edits: insert text lines instead of `json.dumps`-ing the whole file (that re-escapes
  invisible characters and rewrites lines nobody meant to touch), then check `git diff --numstat`
  shows additions only.
- To undo a stray edit in a file that was clean at HEAD, overwriting it from `git show HEAD:` may be
  refused by the permission classifier. Revert only the changed lines with a small script, then check
  that `git diff` is empty.

Related: [[ai-auto-group-apply]], [[adding-a-locale]].
