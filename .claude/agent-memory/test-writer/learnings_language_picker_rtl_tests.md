---
name: language-picker-rtl-tests
description: Pitfalls testing the searchable language picker and RTL popup (accessible names, toaster side, Settings has no Cancel button)
metadata:
  type: reference
---

- Picker options carry one `aria-label` joined with ", " ("Deutsch, German", "עברית, Hebrew, Right-to-left"), so match with `^Name(,|$)` or an exact name. Without it, a name built from separate flex spans comes out as "Deutsch , German" (a space before each comma); that shape in a test means the label was lost.
- Do not write the regex helper through a Python/bash heredoc or `sed`: backslashes (`\s`) get eaten and the pattern silently becomes the letter `s`. Use the Edit tool.
- Settings has no Cancel button; "cancel" means closing the dialog (Escape) without "Save changes". Unit-test it by unmounting and checking `i18n.language`, the `tabmerger-locale` key and a fresh render.
- After a language change in jsdom, `document.documentElement.lang` can leak between tests in the same file; assert on `i18n.language` unless the test itself sets it.
- RTL toaster: sonner's `[data-sonner-toaster]` carries `data-x-position="left"` in RTL, `"right"` in LTR; also check the toast bounding box x.
- In a non-English UI, find buttons by `i18n.t(key)` rather than a hard-coded English name.
- The two known load-flaky unit tests (main.test.tsx, autoBackupDownload.test.ts) pass in a full run on an idle machine; their 5 s timeouts only appear under parallel load.
