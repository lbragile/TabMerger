---
name: learnings_promo_second_replan_2026_07_31
description: Second same-day promo replan — traded the sub-30s cap for a slower 4-beat ~32s cut, and how "hold on end state" was implemented without inventing a new mechanism
metadata:
  type: project
---

Direct viewer feedback on the first 20.6s/five-beat promo cut (see
[[learnings_promo_replan_2026_07_31]] and [[learnings_promo_render_2026_07_31]]):
"not clear on what's going on" — too many beats, not enough hold time per beat.
Decision: trade the sub-30s target for clarity, a 4-beat ~32s cut.

**"Extend the hold" = bump `durationMs`, nothing fancier.** `runStepAction` in
`lib/actions.ts` already treats `durationMs` as a minimum: it runs the action
handler, then `page.waitForTimeout`s out the remainder if the handler finished
early. Since `open-popup`/`chaos-hook`/`drag-reorder`'s actions all settle in a
couple seconds, bumping their `durationMs` (2718→9000, 2400→5000, 4200→11000)
produces exactly "hold longer on the settled end state" for free — no Remotion-side
freeze-frame trick needed. This matches the existing "durationMs is a record-time
minimum AND a Composition.tsx `<Sequence>` hard cap" double-duty design (see
[[learnings_ripple_root_cause_and_pacing]]) — don't invent a second pattern when
the existing one already does this.

**Bumped the shared `demoScript` entries, not `promoScript`-only overrides.**
`record.ts` only ever reads `demoScript` to decide what to record — a
`promoScript`-only duration override would produce a Sequence longer than the
actual recorded clip, running the source dry (`OffthreadVideo` past its end is
untested territory in this pipeline, not something to rely on). Bumping the
shared entry is the sanctioned move per the demoScript-vs-promoScript
single-source-of-truth rule; the (harmless) side effect is the full walkthrough
video now holds slightly longer on those three beats too.

**Dropped two beats entirely, didn't shorten them**: `view-groups` (redundant
once open-popup's extended hold already shows the settled/organized group list)
and `star-group` (judged the weakest, least self-explanatory beat even
with a good caption — same "no visible payoff in isolation" problem as the
already-cut `selection-mode`).

**Re-record is a full wipe-and-redo, not incremental.** `record.ts`'s `main()`
unconditionally `rmSync`s the whole `RECORDINGS_DIR` before checking which steps
are missing — so bumping durationMs on 3 of 17 steps still means re-recording
*all* steps for both themes (the per-step "skip if file exists" resume logic only
helps with mid-run crash recovery, not incremental duration changes). Budget for
a full record:dark + record:light pass any time a single step's durationMs
changes.

**Frame math check**: `getTotalDurationInFrames` includes `INTRO_DURATION_MS`
(1500ms/45 frames) on top of the script's own steps — don't forget this constant
when predicting total rendered frame count from a script's summed `durationMs`.
Confirmed via `remotion render`'s own frame counter (1005 frames = 45 intro +
150+270+330+210 beat frames), not by guessing.
