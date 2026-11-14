---
name: learnings-section-views-mainview
description: uiStore.mainView read-only views (archived group, session) + sidebar accordion; why a separate read-only list, one-current-row rule, test-mock and CRLF gotchas
metadata:
  type: reference
---

Archived and Sessions sidebar rows open read-only views in the main panel (groundwork for the
recently closed tabs feature). Shape:

- `uiStore.mainView` (`{kind:'group'} | {kind:'archived',groupId} | {kind:'session',sessionId}`),
  `openMainView(view, returnGroupId)`, `closeMainView(groups?)`. `setActiveGroupIndex` always resets
  to the group view, so every existing "select a group" path (Ctrl+K, arrows, spring-open, tour)
  closes a view for free. `mainViewReturnGroupId` re-finds the previous group BY ID on close
  (positions shift when a group above is deleted). Not in undo snapshots (those are GroupsState only).
- `components/SectionView/MainPanel.tsx` picks the view and falls back (effect) when the item is
  gone: archived group no longer archived/present, session missing once `useSessions` has data
  (undefined = still loading, not gone). It also refocuses the group's sidebar row when focus fell
  to `<body>` on the way back.
- **Read-only list is its own component (`ReadOnlyWindows`)**, not Window/Tab with a flag: those
  call `useSortable` / register drop targets in the app-wide DnD context, roving tabindex, selection,
  keyboard move, AI scope. Rows must NOT carry `data-group-index/window-index/tab-index`:
  `useKeyboardNav` reads them from `document.activeElement` for Delete / F2 / N.
  Up/Down inside the list `preventDefault` so the document-level arrow handler (group switching)
  skips them.
- **One current row:** a group row is current only while `mainView.kind === 'group'`
  (`GroupContextMenu` `wrapperCurrent` -> `aria-current="page"`; name `font-semibold` vs
  `font-normal`). Section rows use `SIDEBAR_ROW(_ACTIVE)` + `sidebarRowNameClass` in SidebarSection.tsx.
  Header AI menu treats a non-group view as "no group selected" (`activeGroup` undefined).
- Accordion: `uiStore.openSidebarSection` + `toggleSidebarSection`; section ids in
  `lib/sidebarSections.ts` (NOT the store module).

Gotchas:
- Many tests `vi.mock('@/stores/uiStore', () => ({ useUIStore: sel => mock(sel) }))`: a new named
  export imported from the store (a constant) throws there, `useUIStore.getState()` is undefined,
  and new state fields are undefined. Hence: constants in a separate lib module, selectors instead of
  `getState()` in components, `s.mainView?.kind ?? 'group'` / `?? fallback` in shared components.
  Tests that toggle the accordion were switched to the REAL store (`useUIStore.setState({...base,
  setActiveGroupIndex: mockFn})` overrides actions fine). A test file that shares the real store
  across tests must reset `openSidebarSection` in `beforeEach` (toggle state leaks).
- `MainPanel` calls `useSessions`: App-level tests mocking `@/lib/localDb` need
  `vi.mock('@/hooks/useSessions', ...)`.
- Working tree files are CRLF (autocrlf) while the repo stores LF: Node string-replace scripts must
  normalise `\r\n` first, and a bash heredoc append leaves mixed endings. The Edit tool handles it.
