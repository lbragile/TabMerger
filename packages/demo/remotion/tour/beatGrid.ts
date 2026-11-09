// Beat grid of the tour's music bed, and a pure helper that works out how many frames to add to (or take from) the end
// of each scene so every scene cut lands on a beat. Pure: no imports from the registry, no I/O, so the audio script, the
// report script and (later) the registry can all share it.
//
// The bed is "Day Dreamin' with U" at exactly 120 BPM = one beat every 15 frames at 30 fps (a bar of 4/4 = 60 frames).
// The audio script delays the track so one of its beats lands on TOUR_FIRST_CUT_FRAME; from there every beat is
// firstCut + k * BEAT_FRAMES (plus an optional phase, in frames).

export const TOUR_FPS = 30;
/** Tempo of the music bed (measured: 120.00 BPM, steady). */
export const MUSIC_BPM = 120;
/** One beat in frames at 30 fps (exactly 15 for 120 BPM). */
export const BEAT_FRAMES = (60 / MUSIC_BPM) * TOUR_FPS;
/** One bar of 4/4 in frames. */
export const BAR_FRAMES = BEAT_FRAMES * 4;
/** Largest change to a scene's length that snapping may make: one beat is 15 frames, so +-7 always reaches a beat. */
export const MAX_SNAP_FRAMES = 7;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Signed distance in frames from `frame` to the nearest beat (positive = after the beat). */
export function beatOffset(frame: number, firstCut: number, phase = 0): number {
    const r = mod(frame - firstCut - phase, BEAT_FRAMES);
    return r > BEAT_FRAMES / 2 ? r - BEAT_FRAMES : r;
}

export interface SnapInput {
    /** Each scene's length in frames (registry `durationInFrames`). */
    durations: number[];
    /** Frame where scene 1 starts (the intro hold plus the dissolve): the beat grid is anchored here. */
    firstCut: number;
    /** Dissolve length between scenes (each scene adds this many frames before its content). */
    transition: number;
    /** Shift of the whole grid in frames (default 0). */
    phase?: number;
    /** Largest +- change per scene (default 7). */
    maxExtra?: number;
    /**
     * Frames each scene can lose from its end without touching real footage events (its last-frame hold), per scene.
     * A scene that cannot lose enough is lengthened by one beat more instead. Default: `maxExtra` for every scene.
     */
    maxShorten?: number[];
    /**
     * Also make the closing card's start land on a bar boundary (multiples of 60 frames from the first cut), by moving
     * whole beats between scenes (+-15 frames on the scenes where that costs least). Default false: it usually costs a few extra beats of hold. This can push a
     * scene past `maxExtra` (see `barMaxExtra`); the result reports the beats moved in `barShiftApplied`.
     */
    barAlignClosing?: boolean;
    /** Largest |extra| the bar alignment may use on one scene (default 30: two beats). Shortening still respects `maxShorten`. */
    barMaxExtra?: number;
}

export interface SnapResult {
    /** Frames to add to each scene's length (negative = trim from its end hold). */
    extras: number[];
    /** Cut frames (start of each scene's content) before and after snapping. */
    cutsBefore: number[];
    cutsAfter: number[];
    /** Distance of each cut from the nearest beat, before and after (frames; after is always 0). */
    offsetsBefore: number[];
    offsetsAfter: number[];
    /** Video length before and after (the end of the last scene). */
    endBefore: number;
    endAfter: number;
    /** Whole beats moved (negative = shortened) to land the closing card's start on a bar boundary. */
    barShiftApplied: number;
    /** True when the closing card's start is on a bar boundary after snapping. */
    closingOnBar: boolean;
    /** Largest |extra| used. */
    maxAbsExtra: number;
}

/** Cut frames for a list of durations: cut k is where scene k's content starts. */
export function cutsFor(durations: number[], firstCut: number, transition: number): number[] {
    const cuts: number[] = [];
    let c = firstCut;
    for (const d of durations) {
        cuts.push(c);
        c += d + transition;
    }
    return cuts;
}

/**
 * Per-scene extra hold frames so that every cut after the first lands on a beat.
 *
 * Scene k's end is moved so cut k+1 sits on the grid given the (already moved) earlier scenes. Because a beat is 15
 * frames, the +-7 range holds exactly one such length, so the answer is unique and no scene ever changes by more than 7
 * frames. The last scene has no cut after it: its end (the video end) is snapped to a beat the same way. Cut 1 (the first
 * scene) is the anchor and never moves.
 */
export function snapScenesToBeats(input: SnapInput): SnapResult {
    const { durations, firstCut, transition, phase = 0, maxExtra = MAX_SNAP_FRAMES, barAlignClosing = false, barMaxExtra = 2 * BEAT_FRAMES } = input;
    const n = durations.length;
    const maxShorten = input.maxShorten ?? durations.map(() => maxExtra);
    const cutsBefore = cutsFor(durations, firstCut, transition);
    const endBefore = cutsBefore[n - 1] + durations[n - 1];

    const extras: number[] = new Array(n).fill(0);
    let cut = firstCut; // the anchor: scene 1's start never moves
    for (let k = 0; k < n; k++) {
        const end = cut + durations[k] + (k < n - 1 ? transition : 0); // where the next cut (or the video end) falls
        const off = beatOffset(end, firstCut, phase); // + = after the beat
        let e = -off; // moves the end to the beat: negative = shorten
        if (-e > maxShorten[k]) e += BEAT_FRAMES; // cannot trim that much without cutting footage: add the other beat
        extras[k] = e;
        cut = end + e;
    }

    // Optionally land the closing card's start on a bar boundary by moving whole beats onto the cheapest scenes: try
    // pulling back (shorten) and pushing forward (lengthen), keep the feasible one with the smaller largest |extra|.
    let barShiftApplied = 0;
    const closingCutOf = (ex: number[]) => cutsFor(durations.map((d, i) => d + ex[i]), firstCut, transition)[n - 1];
    if (barAlignClosing && n > 1) {
        const r = mod(closingCutOf(extras) - firstCut - phase, BAR_FRAMES); // a multiple of 15 here
        if (r !== 0) {
            const tryShift = (units: number) => {
                const ex = extras.slice();
                const sign = Math.sign(units);
                for (let u = 0; u < Math.abs(units); u++) {
                    let best = -1, bestCost = Infinity;
                    for (let k = 0; k < n - 1; k++) {
                        const next = ex[k] + sign * BEAT_FRAMES;
                        if (-next > maxShorten[k] || Math.abs(next) > barMaxExtra) continue;
                        if (Math.abs(next) < bestCost) { bestCost = Math.abs(next); best = k; }
                    }
                    if (best < 0) return null;
                    ex[best] += sign * BEAT_FRAMES;
                }
                // the closing card's own length then re-snaps its end to a beat
                ex[n - 1] = -beatOffset(closingCutOf(ex) + durations[n - 1], firstCut, phase);
                return { ex, units, worst: Math.max(...ex.map((e) => Math.abs(e))) };
            };
            const options = [tryShift(-r / BEAT_FRAMES), tryShift((BAR_FRAMES - r) / BEAT_FRAMES)].filter((o) => o !== null);
            options.sort((x, y) => x.worst - y.worst);
            if (options[0]) {
                options[0].ex.forEach((e, i) => (extras[i] = e));
                barShiftApplied = options[0].units;
            }
        }
    }

    const cutsAfter = cutsFor(durations.map((d, i) => d + extras[i]), firstCut, transition);
    return {
        extras,
        cutsBefore,
        cutsAfter,
        offsetsBefore: cutsBefore.map((c) => beatOffset(c, firstCut, phase)),
        offsetsAfter: cutsAfter.map((c) => beatOffset(c, firstCut, phase)),
        endBefore,
        endAfter: cutsAfter[n - 1] + durations[n - 1] + extras[n - 1],
        barShiftApplied,
        closingOnBar: mod(cutsAfter[n - 1] - firstCut - phase, BAR_FRAMES) === 0,
        maxAbsExtra: Math.max(...extras.map((e) => Math.abs(e))),
    };
}

/**
 * Where the first beat sits in the music file, in seconds (measured on the pinned track, see fetch-tour-music.ts).
 * The audio script starts the file at `musicStartOffsetSec` so one of its beats lands on the tour's first cut.
 */
export const MUSIC_FIRST_BEAT_SEC = 0.49;

/** Where in the music file the tour's frame 0 plays from, so a beat falls exactly on `firstCut` (0 to one beat). */
export function musicStartOffsetSec(firstCut: number, firstBeatSec = MUSIC_FIRST_BEAT_SEC): number {
    const beatSec = 60 / MUSIC_BPM;
    return mod(firstBeatSec - firstCut / TOUR_FPS, beatSec);
}
