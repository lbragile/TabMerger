---
name: learnings-keyboard-move-reanchor
description: Keyboard move mode re-anchors its picked-up item(s) by identity on every groups cache update; cache-subscriber timing, row-node persistence and the test pattern that runs the real commit
metadata:
  type: project
---

# Keyboard move mode: the picked-up item stays the same item

Rule (spec `docs/drag-and-drop-spec.md` §5.1): on every groups cache update `useKeyboardMove` re-anchors the picked-up source by identity with `rebaseMove`, then `rebuildMove`s the targets. Identity lost (gone, duplicates permuted, a missing member maybe edited) cancels with "The groups changed, so the movement was cancelled."

Related: [[learnings-multi-drag-and-commit-rebase]], [[keyboard-move-list-mode]].

## Things worth knowing next time

- **A `QueryCache.subscribe` listener runs synchronously inside `setQueryData`**, before React's query observers are notified (those are scheduled). So the listener always sees the PRE-render DOM and may be running inside someone else's render/effect/`flushSync`: no `flushSync` in it. Anything that depends on rendered rows (targets filtered by `isVisible`, collapsing a row that only mounts with the render) is redone in the follow frames (`catchUp` in the controller), not in the listener.
- **`rebaseMove` can re-anchor a source alone**: pass the "new group" sentinel (`{ type: 'new-group', id: NEW_GROUP_ID }`) as the target; it resolves against any state. No second identity implementation is needed.
- **Tab and window rows are keyed by their positional model id**, so their DOM nodes survive a cache update and keep imperative inline styles and attributes. When the moving ids change, restore the rows collapsed for the old ids before collapsing the rows of the new ones (`collapseRendered` already does restore-then-collapse).
- **Announce on changed TEXT, not changed key.** Target keys are positional, so a re-anchored origin has a new key but reads the same; re-speaking it would replace the pick-up instructions in the assertive region.
- `rebuildMove` keeps a cursor that was on the item's own slot on that slot (`origin` flag wins over the key).

## Test pattern

`src/__tests__/unit/hooks/useKeyboardMoveReanchor.test.tsx` runs the controller against the REAL commit: `vi.mock('@/components/dnd/DndProvider')` returns a hoisted holder that a probe component fills with `useDndHandlers()`'s `commitKeyboardMove` / `applyGap`; only `@/lib/localDb` and analytics are mocked, so assertions are on what `saveGroupsState` received. Rows are plain divs with `data-tm-dnd-id`; mount the rows of the new state after the injected `setQueryData` to play the part of React's render, then wait real time (rAF is stubbed to `setTimeout`) for the follow frames.

Mutation check used: short-circuit the `state !== anchored` branch and 16 tests fail.
