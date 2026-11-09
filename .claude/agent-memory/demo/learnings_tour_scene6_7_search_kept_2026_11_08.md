---
name: tour-scene6-7-search-kept
description: Tour scenes 6/7 after the search rework - a pick keeps the query, so the recorders must click Clear search; product highlight replaces the drawn ring; capture-rate check under load
metadata:
  type: reference
---

- After the search rework a picked result keeps the query (sidebar stays filtered, product highlights matches yellow, `revealTab` focuses the row). Scene 6 therefore ends with a click on `[data-testid="header-clear-search"]`; every recorder that replays scene 6 inline must do the same or its first frame differs from scene 6's last.
- The product's yellow match highlight made the scene's own drawn ring redundant; it was removed (prefer real product visuals over overlays).
- The Clear-search button unmounts on click: wait for its absence, then flick the pointer away (no glide across rows).
- Capture rate: with several recorders running at once (CPU ~50%) a take had ~50% unique frames in motion and 1.5x the wall time (holds were not shorter, glides were slower). Check with an md5 run-map of consecutive frames (X = new, . = duplicate); an idle-machine take is ~80% unique in motion. Re-record until ~65-75%.
- Scene durations derive from the dark footage (`SCENE_0x_FRAMES`); the registry picks them up automatically.
