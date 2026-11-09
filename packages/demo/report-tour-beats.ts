// Prints, for the current registry, how far each scene cut is from the music's beat grid before and after snapping
// (see remotion/tour/beatGrid.ts). Read-only: it changes nothing; the extras it prints are what the registry would add
// to each scene's duration once the beat snapping is wired in.
//
// Usage: pnpm --filter @tabmerger/demo beats:tour [--bar]
import { TOUR_FIRST_CUT_FRAME, TOUR_SCENES } from "./remotion/tour/registry";
import { TRANSITION_FRAMES } from "./remotion/Composition";
import { BAR_FRAMES, BEAT_FRAMES, snapScenesToBeats } from "./remotion/tour/beatGrid";

const r = snapScenesToBeats({
    durations: TOUR_SCENES.map((s) => s.baseDurationInFrames),
    maxShorten: TOUR_SCENES.map((s) => s.maxShorten),
    firstCut: TOUR_FIRST_CUT_FRAME,
    transition: TRANSITION_FRAMES,
    barAlignClosing: process.argv.includes("--bar"),
});
const pad = (v: string | number, n: number) => String(v).padStart(n);
console.log(`beat = ${BEAT_FRAMES} frames, bar = ${BAR_FRAMES} frames, anchored at frame ${TOUR_FIRST_CUT_FRAME}`);
console.log(`${"scene".padEnd(20)}${pad("dur", 5)}${pad("extra", 7)}${pad("cut", 7)}${pad("off", 5)}${pad("cut'", 7)}${pad("off'", 5)}${pad("beat#", 7)}`);
TOUR_SCENES.forEach((s, k) => {
    const beatNo = (r.cutsAfter[k] - TOUR_FIRST_CUT_FRAME) / BEAT_FRAMES;
    console.log(`${s.id.padEnd(20)}${pad(s.baseDurationInFrames, 5)}${pad(r.extras[k] > 0 ? "+" + r.extras[k] : r.extras[k], 7)}${pad(r.cutsBefore[k], 7)}${pad(r.offsetsBefore[k], 5)}${pad(r.cutsAfter[k], 7)}${pad(r.offsetsAfter[k], 5)}${pad(beatNo, 7)}`);
});
console.log(`video length ${r.endBefore} -> ${r.endAfter} frames; max |extra| ${r.maxAbsExtra}; closing card starts on a bar: ${r.closingOnBar} (beats moved: ${r.barShiftApplied})`);
if (!process.argv.includes("--bar")) {
    const b = snapScenesToBeats({ durations: TOUR_SCENES.map((s) => s.baseDurationInFrames), maxShorten: TOUR_SCENES.map((s) => s.maxShorten), firstCut: TOUR_FIRST_CUT_FRAME, transition: TRANSITION_FRAMES, barAlignClosing: true });
    console.log(`with --bar: closing card on a bar: ${b.closingOnBar}, video ${b.endAfter} frames, max |extra| ${b.maxAbsExtra}, extras ${b.extras.join(" ")}`);
}
