---
name: learnings-narration-piper-and-record-resilience
description: Piper TTS narration pipeline setup (voice download, Windows onnxruntime DLL fix, GPLv3 license note) and a record.ts crash-resume fix that resolved the previously-unresolved sandbox Chrome-crash blocker
metadata:
  type: project
---

## Piper TTS narration (narrate.ts, public/audio/{step.id}.wav)

- `piper1-gpl` (OHF-Voice/piper1-gpl) really is **GPLv3**, confirmed via `gh api repos/OHF-Voice/piper1-gpl` (`license.spdx_id: GPL-3.0`)
  and the repo's `COPYING` file — a real license change from the original MIT `rhasspy/piper` it forked from, not just a scary repo
  name. Since this pipeline only shells out to it via `child_process` (never imports/links its code), GPL doesn't propagate to
  TabMerger, but don't casually vendor/bundle the venv or binary into anything redistributed without checking that boundary again.
- Install path: plain `pip install piper-tts` (or a venv's pip) — no separate binary download, no Rust/C build step. Voice models are
  a separate download via `python -m piper.download_voices <voice> --data-dir <dir>` (pulls from the `rhasspy/piper-voices` HF repo
  under the hood — don't hardcode a HuggingFace URL, the download command handles it and is more likely to survive repo reshuffles).
- **Windows `onnxruntime` DLL import failure is a VC++ redist version issue, not a Python/onnxruntime version issue.** Symptom:
  `ImportError: DLL load failed while importing onnxruntime_pybind11_state: A dynamic link library (DLL) initialization routine
  failed`. This reproduced identically across onnxruntime 1.24.1 through 1.28.0 (every cp314-compatible version available on PyPI at
  the time) — ruling out "try an older onnxruntime" as the fix. The actual cause: an outdated system VC++ 2015+ x64 redistributable
  (`HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\X64` showed `14.22.27821.00`, from ~2019). Fixed by
  `winget install --id Microsoft.VCRedist.2015+.x64 -e --accept-source-agreements --accept-package-agreements` (upgraded to
  `14.51.36247.0`) — import worked immediately after, no Python/venv changes needed. Check this FIRST on any fresh Windows machine
  before chasing onnxruntime version pinning.
- Voice `en_US-ryan-high` produces ~1.3-3.4s of audio for the short (5-10 word) captions in `demo-script.ts` — always ended up shorter
  than the video steps' *original* durationMs for the longer scenes (settings-walkthrough, add-note, rename-tab, rename-group,
  search, selection-mode all had headroom already) but exceeded the *short*, punchy-cut steps (hook, open-popup, tab-preview,
  star-window, star-group, stale-tabs, outro) by 100-2000ms. Don't assume short captions mean short narration — "100 tabs open. Zero
  idea where anything is." (a 6-word hook line) took 3.3s to speak, nearly double its 1.6s pre-narration `durationMs`.
- WAV duration doesn't need ffprobe — Piper's default output is plain PCM16 mono, so a ~15-line manual RIFF header parse
  (`byteRate` at offset 28, `data` chunk size right after the literal `"data"` bytes) is enough; see `narrate.ts`'s `wavDurationMs()`.
  Saved a dependency for a single number.
- `Composition.tsx` narration lookup is a single `getStaticFiles()` call up front (`staticFileNames` Set), same pattern as the
  existing `hasAudioTrack` check for the optional background track — NOT a per-step `getStaticFiles()` call in the `.map()`, which
  would re-walk the static file list once per step for no reason.

## record.ts crash-resume fix — resolved the previously-open sandbox Chrome-crash blocker

See [[learnings_undo_scene_and_env_flakiness_2026_07_30]] for the original unresolved report: `record.ts` repeatedly crashed
mid-script (`Target page, context or browser has been closed`) at inconsistent steps (anywhere from step 3 to step 14 of 15) in this
same OneDrive-synced sandboxed Windows environment, and that session gave up after ~8 attempts with no full pass ever completing.

**This time it was actually fixed**, not just retried harder: rewrote `record.ts`'s `main()` to retry-with-resume instead of
retry-from-scratch. Root structure:
- Compute `remaining` = script steps whose `${id}.webm` doesn't already exist in the recordings dir, at the top of each attempt loop
  (capped at `MAX_LAUNCH_ATTEMPTS = 8`).
- On any error inside the per-step recording loop, catch it, `context.close().catch(() => null)`, log which steps are still missing,
  and let the outer loop relaunch a fresh `launchDemoContext` + resume recording ONLY the missing steps — never re-record steps that
  already produced a valid `.webm`.
- Crucially, `fs.rmSync(RECORDINGS_DIR, ...)` now happens exactly ONCE before the attempt loop, not once per attempt — the old code's
  implicit "delete everything, then record everything" per invocation is what made every earlier crash lose ALL prior progress in
  that run, compounding the flakiness into "never completes."

With this change, both `record.ts dark` and `record.ts light` completed full 15/15-step passes in this session — one of them on the
very first attempt post-fix, both comfortably within `MAX_LAUNCH_ATTEMPTS`. The underlying Chrome instability (still not root-caused —
possibly a real per-process memory/handle ceiling from repeated `context.newPage()` + `recordVideo` cycles in this sandbox) is
UNCHANGED and will still crash sometimes; what changed is that a crash now costs "a relaunch + a few remaining steps" instead of "the
entire run's progress." **If record.ts crashes again in this environment, this is expected — just re-run the same command; the resume
logic picks up where it left off** (as long as the recordings dir from the crashed attempt isn't manually deleted first).

Still worth doing before any record.ts run in this environment, per the prior learnings entry: `taskkill //F //IM chrome.exe` and a
few seconds' `sleep` before starting, to avoid `EBUSY`/`Opening in existing browser session` from orphaned processes/OneDrive file
locks on the recordings dir.

See also [[learnings_undo_scene_and_env_flakiness_2026_07_30]], [[learnings_video_blur_devicescalefactor]].
