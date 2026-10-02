# Extension Smoke Test — Agent Memory

- [Lint step (A5) minimatch crash (fixed)](lint_broken_minimatch.md) — eslint crashed before running from a blanket brace-expansion override; now bounded per major
- [content.ts entrypoint (A4) was removed by design](content_script_removed.md) — its absence is expected, not a regression
- [Stale `vi.mock` factory keys survive a deleted hook export](stale_vimock_factory_keys.md) — type-check + build both miss them; grep (check 3) is the only gate
- [DnD onDragOver preview can self-feed into a popup-killing render loop](dnd_ondragover_self_feed_loop.md) — four guards (measuring=BeforeDragging, anchor-under-pointer, idInModel, applyPreview dedupe) must survive any DnD change
- [Popup DnD sensor history + drag-handle onMouseDown rule](mousesensor_onmousedown_clobber.md) — MouseSensor was reverted to a pointer-capture PointerSensor subclass (Mv3PointerSensor); activator is `onPointerDown` again; still compose handle `onMouseDown` with the spread handler
