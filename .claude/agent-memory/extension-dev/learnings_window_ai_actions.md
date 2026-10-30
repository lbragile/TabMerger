---
name: learnings-window-ai-actions
description: Window "AI rename" / "Describe with AI" — AiTarget (group id + window position + tabs key), one gated panel-level WindowAiScope instead of per-row AI hooks, generalized describe/name modals, Git Bash sed/heredoc gotchas
metadata:
  type: reference
---

**Targets.** `lib/aiTarget.ts`: `AiTarget` is `{ kind: 'group', groupId }` or `{ kind: 'window',
groupId, windowIndex, tabsKey }` (`tabsKey` = sorted tab URLs as JSON: saved windows are all `id: 0`,
so a window is its position plus the tabs it held when the request went out). `resolveAiTarget` finds
it again: same position with the same tabs, else the ONLY window of the group holding them (it moved:
star, drag), else `null` ("changed elsewhere"). `AiSubject` (`groupSubject` / `windowSubject`) is what
the actions run on; `subjectBlock` gives `notSaved` (Now Open) / `noTabs`.

**Actions.** `useDescribeAction()` / `useNameAction()` take the subject at RUN time;
`useDescribeGroupAction(group)` / `useNameGroupAction(group)` are thin wrappers. `useSaveNote()` writes
a group note or a window note (`useUpdateWindowNote` at the resolved position) with the same targeted
toast Undo. The modals keep their names (`describeGroupReview`, `nameGroupPicker`); modal data is
`{ groupId, ... }` for a group plus `window: { index, tabsKey }` for a window (`aiTargetModalData` /
`readAiTarget`). Malformed `window` data reads as `null`, never as the whole group.

**Gated host.** Each AI hook calls `useAuth` (getSession + auth listener + storage listener),
`useEntitlements`, settings and usage, so per-window-row hooks would multiply listeners by the window
count. `components/Windows/WindowAiScope.tsx` mounts ONE host (`useNameAction` + `useDescribeAction`)
for the windows panel, only while `aiFeatures` and a switch is on; the host is a fragment SIBLING of the
rows (slot stays stable, rows never remount when it toggles) and hands its latest closures over through
a ref set in a dependency-less `useLayoutEffect`. Rows read `useWindowAiMenu()` (null outside the scope,
so standalone WindowItem tests need no AI mocks). A request started from a menu item keeps running if
the menu or host unmounts: TanStack's `mutateAsync` resolves after the observer unmounts.

**Gating decisions.** Same as the group context menu: hidden (not locked) unless `aiFeatures`; per-feature
switches `aiNameGroupEnabled` / `aiDescribeGroupEnabled` reused, relabelled "Name/Describe groups and
windows"; hidden on Now Open windows (`useCurrentTabs` rebuilds their name to 'Window' and drops notes);
incognito-marked windows not excluded (no group AI path excludes them either). The header ✨ menu has no
window section: the popup has no "selected window" concept.

**Test fallout.** `useSaveNote` now calls `useUpdateWindowNote`, so every `vi.mock('@/hooks/useGroups')`
reached through GroupContextMenu or Header needs it ([[test-mocks-follow-hook-usage]]). Settings tests
find AI switches by label, so relabelling a switch breaks them.

**Git Bash gotchas.** `sed -i` rewrote a CRLF file (CHROMEWEBSTORE.md) with LF line endings; restore
with a Python `newline=''` rewrite and check `file <path>` for CRLF. Long `python - <<'EOF'` heredocs
with many apostrophes sometimes fail with "unexpected EOF while looking for matching `''": write the
script to the scratchpad with the Write tool and run it instead. Locale plural keys differ per language
(`id` has only `_other`), so anchor catalog inserts on a key prefix, not on `_one`.

Related: [[learnings-ai-menu-sections-describe-group]], [[learnings-name-picker-and-locked-ai-preview]], [[learnings-scratchpad-script-names]]
