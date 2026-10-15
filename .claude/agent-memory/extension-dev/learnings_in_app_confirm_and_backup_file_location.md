---
name: in-app-confirm-and-backup-file-location
description: useConfirm / ConfirmDialog replace native confirm() (nested alertdialog over Settings), and the downloads API facts behind "Last file" / "Show in folder"; probe build recipe that leaves .output alone
metadata:
  type: reference
---

**In-app confirmation (`hooks/useConfirm.tsx`, `components/Modal/ConfirmDialog.tsx`).**
`const { confirm, confirmDialog } = useConfirm()`; `await confirm({ title, description,
confirmLabel, destructive })` resolves a boolean; render `{confirmDialog}` in the asking component.
No native `confirm()` / `alert()` / `prompt()` is left in `src/`.

- It is its own Radix Dialog, not a `uiStore.modal` entry: the store has one slot, so a
  confirmation opened through it from Settings unmounts Settings (see
  [[uistore-single-modal-slot]]). Rendered inside the asking component's React tree it stacks:
  Radix treats a portal rendered by a child of the outer dialog as "inside", so Escape closes only
  the top box and the outer dialog is not dismissed.
- `role="alertdialog"` can be passed straight to the shared `DialogContent` (props are spread
  after Radix's own `role="dialog"`); no `@radix-ui/react-alert-dialog` dependency is needed.
  Outside clicks are prevented with `onPointerDownOutside` / `onInteractOutside`.
- The shared `DialogContent` cancels Radix's focus return (`onCloseAutoFocus` preventDefault), so
  the hook records `document.activeElement` when asked and focuses it from `onCloseAutoFocus`.
  After a file picker the active element is not the button: pass `returnFocusTo`.
- When the trigger disappears after confirming (a deleted row), the outer dialog's focus scope
  moves focus to its own container; nothing extra is needed.
- A file `<input>` keeps its value, so choosing the same file again after Cancel fires no
  `change`: clear `e.target.value` after reading `files[0]`.
- Selectors that look for `[role="dialog"]` do not match an `alertdialog`.

**Downloads API (optional `downloads` permission), measured headless in Chromium.**

- `downloads.download` resolves with the id when the download STARTS. `search({ id })` then
  gives `filename` (absolute path), `state`, `exists`.
- `exists` is refreshed lazily: `search()` triggers the check and the result can arrive later as
  an `onChanged` event, so listen for the id and re-read. After `removeFile(id)` the next read
  already said `exists: false`.
- Download ids belong to one browser profile: keep them in the local settings store, in
  `ACCOUNT_SCOPED_SETTING_KEYS`, never in anything synced.
- `chrome.downloads.show` / `showDefaultFolder` return nothing in Chrome; Firefox's `show`
  resolves `false` when it could not show the file. Desktop Firefox supports `search` (47),
  `show` and `showDefaultFolder` (48); Firefox for Android dropped the downloads API in 79.
  Source: MDN browser-compat-data `webextensions/api/downloads.json`.
- A path read back from the browser is untrusted text: `toDisplayPath` (shared) drops control and
  text-direction characters and caps the length; render as text with `break-all`, never a link.
- In an extension page the methods on `chrome.downloads` can be reassigned, which lets a
  Playwright probe record `show` / `showDefaultFolder` calls and fake a `search` answer.
- Playwright saves extension downloads under a GUID name in its artifacts folder, and that is the
  `filename` `search` reports there.

**Probe build without touching `.output`.** A config file outside the repo that imports the real
one and overrides `outDir` builds anywhere:
`export default { ...base, outDir: '<temp>/out' }`, then
`TM_E2E_GRANT_DOWNLOADS=1 pnpm exec wxt build --mode development -c <temp>/wxt.probe.config.ts`
from `packages/extension`, and `TM_E2E_EXT_DIR=<temp>/out/chrome-mv3-dev` for the run. A temporary
spec must live under `e2e/` (module resolution); `e2e/repro/*.repro.ts` with the repro config
works. `pnpm exec playwright` only resolves from the package root, not from `e2e/`.

Editing with a `node` script that matches multi-line strings fails on the files that use CRLF
line endings (`lib/syncSettingKeys.ts`, `lib/autoBackup.ts` among them); the Edit tool handles both.
