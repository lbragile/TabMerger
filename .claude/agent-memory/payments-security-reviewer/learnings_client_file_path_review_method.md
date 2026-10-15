---
name: client-file-path-review-method
description: Audit questions for a feature that writes a file to disk at a path built from user-set folder and name-pattern settings (extension downloads API), and for build-time test switches
metadata:
  type: reference
---

Questions to ask when stored settings become a path passed to `chrome.downloads.download`:

- **Who can write the setting?** Trace the storage key: is it synced, imported from a file, or reachable from a bridge message? A device-local IndexedDB setting is only writable from extension pages. Also ask whether it survives an account switch on the same profile.
- **Validate where it is used, not only where it is typed.** The worker must normalise the stored values on every run and check the FINISHED path segment by segment (after token expansion and after the extension is appended), falling back to defaults.
- **Token expansion is a transform after validation.** A validator that checks one sample rendering misses values that only become unsafe with other numbers: a counter token after `com` or `lpt` renders a Windows device name for some counts. Reserved names apply with any extension.
- **The separator characters do most of the work.** Rejecting `:` covers drive letters and alternate data streams; turning `\` into `/` first, then rejecting a leading `/`, covers UNC and absolute paths. Check trim-vs-raw comparisons for leading/trailing space and dot.
- **The extension is appended, never typed**, and the MIME type of a `data:`/blob URL is a constant: confirm neither takes any user input. `conflictAction: 'uniquify'` keeps the extension.
- **The browser is the last line.** The downloads API refuses absolute paths and `..` itself; app validation is defence in depth, so rate gaps in it accordingly.
- **Build-time test switches**: check the condition uses the bundler's resolved mode (not `NODE_ENV`, not argv parsing alone), list every script and workflow that passes a mode, and check whether a CI baseline of the built production manifest would catch the switch leaking.
- **Guard-conditional writes**: a guard that is "key still holds value X" only works if every wipe deletes the key inside the same transaction that clears the data. Look for key lists read before the transaction opens.
