// Procedurally synthesises the feature tour's sound design (no samples, no music, no third-party audio, so
// there is nothing to license or credit and the result is deterministic): `public/tour/audio/tour-<theme>.wav`,
// plus `out/tour/audio/tour-audio-<theme>.json` (events, cuts, loudness) for the sync chart.
//
// There is no music bed: the tour is silent between sounds. The sounds, all in D major, are
//   - a rising stack of pentatonic notes under the poster intro,
//   - short sounds on the real events of each scene (tick, pluck, thump, chime; one soft tonal swell when the
//     second device arrives in the sync scene). Nothing is tied to a scene cut: no whoosh, no swell, no
//     transition sound of any kind,
//   - a strummed chord on the closing card that rings out,
//   and everything fades to exact silence at the last frame.
//
// Timing comes from the real data, not by eye: scene cut frames from the registry
// (getTourCutFrames), event frames from lib/tour*Footage.json mapped through each scene's
// START / FOOTAGE_SPEED (the constants below mirror the scene components). The tour has the same
// scene durations in both themes but footage events differ by a few frames, so each theme gets its
// own track.
//
// Loudness: the mix gets a fixed gain (SFX_GAIN_DB) and ffmpeg's alimiter keeps the peaks under a ceiling of
// about -1.9 dBTP. The gain is a constant rather than a normalisation to a target LUFS on purpose: with long
// silences the integrated loudness depends on how many sounds there are, so normalising would change the
// level of every individual sound whenever one was added or removed. Integrated loudness, true peak and
// loudness range are measured with ffmpeg's ebur128 and written to the JSON (see TM_FFMPEG below).
//
// Usage: pnpm --filter @tabmerger/demo audio:tour [dark|light]   (default: both)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TOUR_SCENES, getTourCutFrames, getTourDurationInFrames } from "./remotion/tour/registry";

const FPS = 30;
const SR = 44100;
/** Gain applied to the mix before the limiter: 7.5 dB, the gain the approved sound design was balanced with. */
const SFX_GAIN_DB = 7.5;
/** alimiter settings (limit 0.8 = -1.94 dBFS); a ceiling for the strummed closing chord, the loudest sound. */
const LIMITER = "alimiter=limit=0.8:attack=3:release=60:level=disabled";
/** The key every sound is built from: D major (tonic as a pitch class, C = 0). */
const TONIC = 2;
/** Seconds of the final fade to silence (the last 60 ms stay silent). */
const FADE_OUT = 3.4;

/** Per-scene mapping of a footage frame to a scene-local frame: local = START + (frame - 1) / SPEED (mirrors the scene files). */
const MAPPING: Record<string, { footage: string; start: number; speed: number }> = {
    "drag-to-new-group": { footage: "tourWindowFootage", start: 12, speed: 1.25 },
    "organise-tabs": { footage: "tourOrganiseTabsFootage", start: 4, speed: 1.5 },
    "name-and-note": { footage: "tourNameAndNoteFootage", start: 0, speed: 1.3 },
    "find-a-tab": { footage: "tourFindATabFootage", start: 0, speed: 1 },
    "restore-group": { footage: "tourRestoreGroupFootage", start: 0, speed: 1.4 },
    "share-group": { footage: "tourShareGroupFootage", start: 0, speed: 1.5 },
};
type Kind = "tick" | "pluck" | "thump" | "chime" | "swell";
/** Which footage events get which sound. */
const ACCENTS: Record<string, [event: string, kind: Kind][]> = {
    "drag-to-new-group": [["pickup", "tick"], ["drop", "thump"], ["windowClosed", "pluck"], ["renameText", "tick"], ["renameInput", "tick"], ["colorDot", "tick"], ["apply", "chime"]],
    "organise-tabs": [["aPickup", "tick"], ["aDrop", "thump"], ["selectCalendar", "tick"], ["selectSlack", "tick"], ["bPickup", "tick"], ["bDrop", "thump"], ["selectionCleared", "pluck"]],
    "name-and-note": [["renameDblclick", "tick"], ["renameCommit", "pluck"], ["noteMenuOpen", "tick"], ["noteItemClick", "tick"], ["noteSave", "pluck"], ["noteSaved", "chime"]],
    "find-a-tab": [["searchClick", "tick"], ["resultsShown", "pluck"], ["resultClick", "tick"], ["overlayClosed", "chime"]],
    "restore-group": [["groupClick", "tick"], ["open0", "tick"], ["windowCreated0", "chime"], ["open1", "tick"], ["windowCreated1", "chime"]],
    "share-group": [["selectClick", "tick"], ["groupTick", "tick"], ["shareClick", "pluck"], ["toastShown", "chime"]],
};
/** Sounds with fixed scene-local frames (scenes without footage events), from the scene constants. */
const FIXED: Record<string, [local: number, kind: Kind][]> = {
    "the-mess": [[0, "thump"], [26, "thump"], [52, "thump"]], // MESS_LAYOUT arriveAt
    "open-tabmerger": [[40, "tick"], [64, "pluck"], [98, "pluck"], [132, "chime"]], // CLICK_AT and the three pairs
    "sync-devices": [[12, "swell"], [26, "chime"]], // B arrives, then settles
    "closing-card": [[8, "pluck"], [18, "pluck"], [28, "pluck"], [38, "chime"]], // logo, name, tagline, call to action
};
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
/** D major pentatonic, as semitone offsets from the tonic. */
const PENT = [0, 2, 4, 7, 9];

const argv = process.argv.slice(2);
const theme = (argv.find((a) => !a.startsWith("--")) ?? "both") as "dark" | "light" | "both";
const themes: ("dark" | "light")[] = theme === "both" ? ["dark", "light"] : [theme];

function loadEvents(file: string, t: "dark" | "light"): Record<string, number> {
    const j = JSON.parse(fs.readFileSync(path.resolve(__dirname, `lib/${file}.json`), "utf-8"));
    return (j.events[t] ?? j.events.dark) as Record<string, number>;
}

/** Everything except the intro rise and the closing chord: the sounds on the scene events. */
function synth(t: "dark" | "light") {
    const total = getTourDurationInFrames();
    const N = Math.ceil((total / FPS) * SR);
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    const cuts = getTourCutFrames();
    const sceneIds = TOUR_SCENES.map((s) => s.id);

    const frameToSample = (f: number) => Math.round((f / FPS) * SR);
    const add = (start: number, data: Float32Array, gL: number, gR: number) => {
        // every sound ends with a 25 ms half-cosine fade so no event can click
        const tail = Math.round(0.025 * SR);
        for (let i = 0; i < data.length; i++) {
            const k = start + i;
            if (k < 0 || k >= N) continue;
            const left = data.length - i;
            const f = left < tail ? 0.5 - 0.5 * Math.cos((Math.PI * left) / tail) : 1;
            L[k] += data[i] * gL * f;
            R[k] += data[i] * gR * f;
        }
    };
    const env = (n: number, att: number, tau: number) => {
        const o = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = i / SR;
            o[i] = (x < att ? x / att : 1) * Math.exp(-x / tau);
        }
        return o;
    };
    const tone = (f: number, dur: number, att: number, tau: number, harm: number[] = [1]) => {
        const n = Math.ceil(dur * SR);
        const e = env(n, att, tau);
        const o = new Float32Array(n);
        for (let h = 0; h < harm.length; h++) for (let i = 0; i < n; i++) o[i] += harm[h] * Math.sin(2 * Math.PI * f * (h + 1) * (i / SR)) * e[i];
        return o;
    };
    const events: { frame: number; kind: Kind; label: string }[] = [];
    let counter = 0;
    // every sound is built from the key: its tonic chord, a pentatonic walk and key-tuned tick and thump pitches
    const chord = [48 + TONIC, 48 + TONIC + 4, 55 + TONIC, 60 + TONIC];
    const accent = (frame: number, kind: Kind, label: string) => {
        events.push({ frame, kind, label });
        const s0 = frameToSample(frame);
        const pan = 0.5 + 0.18 * Math.sin(counter * 1.7);
        const gL = Math.cos(pan * Math.PI * 0.5), gR = Math.sin(pan * Math.PI * 0.5);
        // C5..B5 base, an octave down if it would pass G6: cannot clash
        let note = 72 + TONIC + PENT[(counter * 2) % PENT.length];
        if (note > 91) note -= 12;
        counter++;
        const tickHz = midi(84 + ((TONIC + 7) % 12));
        const thumpEnd = midi(36 + TONIC);
        if (kind === "tick") add(s0, tone(tickHz, 0.2, 0.003, 0.02), 0.05 * gL, 0.05 * gR);
        else if (kind === "pluck") add(s0, tone(midi(note), 1.4, 0.008, 0.2, [1, 0.3]), 0.1 * gL, 0.1 * gR);
        else if (kind === "thump") {
            const n = Math.ceil(0.7 * SR);
            const o = new Float32Array(n);
            let ph = 0;
            for (let i = 0; i < n; i++) {
                const x = i / SR;
                const f = thumpEnd + thumpEnd * 0.6 * Math.exp(-x / 0.05);
                ph += (2 * Math.PI * f) / SR;
                o[i] = Math.sin(ph) * (x < 0.004 ? x / 0.004 : 1) * Math.exp(-x / 0.09);
            }
            add(s0, o, 0.16, 0.16);
            add(s0, tone(midi(note), 1.0, 0.008, 0.14, [1, 0.25]), 0.07 * gL, 0.07 * gR);
        } else if (kind === "chime") {
            const ns = [note, note + 4, note + 7];
            ns.forEach((m, i) => add(s0 + Math.round(i * 0.085 * SR), tone(midi(m), 2.6, 0.01, 0.42, [1, 0.2]), 0.065 * gL, 0.065 * gR));
        } else if (kind === "swell") {
            // a soft tonal swell (no noise): the key's root and fifth an octave up, peaking at the event frame
            const n = Math.ceil(0.9 * SR);
            const o = new Float32Array(n);
            const f1 = midi(chord[0] + 12), f2 = midi(chord[1] + 12);
            for (let i = 0; i < n; i++) {
                const x = i / n;
                const sec = i / SR;
                const e = x < 0.55 ? Math.pow(Math.sin((Math.PI / 2) * (x / 0.55)), 2) : Math.pow(Math.cos((Math.PI / 2) * ((x - 0.55) / 0.45)), 2);
                o[i] = (Math.sin(2 * Math.PI * f1 * sec) + Math.sin(2 * Math.PI * f2 * sec)) * e * 0.5;
            }
            add(s0 - Math.round(0.5 * SR), o, 0.08, 0.08);
        }
    };

    sceneIds.forEach((id, k) => {
        const cut = cuts[k];
        if (FIXED[id]) for (const [local, kind] of FIXED[id]) accent(cut + local, kind, `${id}:fixed@${local}`);
        const map = MAPPING[id];
        if (map && ACCENTS[id]) {
            const ev = loadEvents(map.footage, t);
            for (const [name, kind] of ACCENTS[id]) {
                if (ev[name] === undefined) continue;
                const local = map.start + (ev[name] - 1) / map.speed;
                accent(Math.round(cut + local), kind, `${id}:${name}`);
            }
        }
        // the swells that used to peak at every cut after the first are gone, but each one advanced `counter`
        // (which picks the note and pan of the next sound): keep that step so every other sound is unchanged
        if (k > 0) counter++;
    });
    // the closing card resolves with a soft low bloom at its content start
    accent(cuts[cuts.length - 1] + 38, "thump", "closing:resolve");

    // soft low-pass so the sounds stay free of harsh highs
    const lp = (a: Float32Array, fc: number) => {
        const x = Math.exp((-2 * Math.PI * fc) / SR);
        let y = 0;
        for (let i = 0; i < a.length; i++) {
            y = (1 - x) * a[i] + x * y;
            a[i] = y;
        }
    };
    lp(L, 7000); lp(R, 7000);
    return { L, R, N, events, cuts, total };
}

/**
 * The two longer sounds, added after the low-pass: a rising pentatonic stack under the poster intro (about 2.3 s) and a
 * strummed chord that rings out on the closing card.
 */
function addIntroAndClosing(L: Float32Array, R: Float32Array, cuts: number[]) {
    const N = L.length;
    const put = (start: number, data: Float32Array, g: number, pan = 0.5) => {
        const gl = Math.cos(pan * Math.PI * 0.5) * g, gr = Math.sin(pan * Math.PI * 0.5) * g, tail = Math.round(0.03 * SR);
        for (let i = 0; i < data.length; i++) {
            const k = start + i;
            if (k < 0 || k >= N) continue;
            const left = data.length - i, f = left < tail ? 0.5 - 0.5 * Math.cos((Math.PI * left) / tail) : 1;
            L[k] += data[i] * gl * f; R[k] += data[i] * gr * f;
        }
    };
    const note = (hz: number, dur: number, tau: number) => {
        const n = Math.ceil(dur * SR), o = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = i / SR; o[i] = (Math.sin(2 * Math.PI * hz * x) + 0.3 * Math.sin(4 * Math.PI * hz * x) + 0.08 * Math.sin(6 * Math.PI * hz * x)) * (x < 0.006 ? x / 0.006 : 1) * Math.exp(-x / tau); }
        return o;
    };
    // rising stack under the intro: pentatonic notes from the key's octave 3 upward
    for (let i = 0; i < 6; i++) {
        const m = 48 + TONIC + PENT[i % 5] + (i >= 5 ? 12 : 0);
        put(Math.round((0.12 + i * 0.2) * SR), note(midi(m), 2.2, 0.55), 0.13, 0.3 + 0.08 * i);
    }
    // closing chord: tonic, fifth, octave, the key's third and a high fifth, strummed over 0.28 s, ringing about 3 s
    const closing = cuts[cuts.length - 1] + 30;
    [0, 7, 12, 16, 19].forEach((d, i) => put(Math.round((closing / FPS) * SR) + Math.round(i * 0.07 * SR), note(midi(48 + TONIC + d), 3.2, 0.9), 0.1, 0.35 + 0.07 * i));
}

/**
 * A full ffmpeg build is needed for the loudness filter (the one bundled with Remotion is minimal and has no ebur128):
 * set TM_FFMPEG to its path (any ffmpeg with ebur128/alimiter, showspectrumpic), or have `ffmpeg` on PATH.
 */
const FFMPEG = process.env.TM_FFMPEG ?? "ffmpeg";
function ffRun(args: string[], input?: Buffer) {
    const r = spawnSync(FFMPEG, args, { input, encoding: "utf-8", maxBuffer: 1 << 28 });
    if (r.error) throw new Error(`could not run ffmpeg (${FFMPEG}); set TM_FFMPEG to a full ffmpeg build: ${r.error.message}`);
    return { out: (r.stderr ?? "") + (r.stdout ?? ""), status: r.status };
}

/** Integrated loudness (LUFS), true peak (dBTP) and loudness range (LU) of an audio file. */
function measure(file: string) {
    const { out } = ffRun(["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
    const tail = out.slice(out.lastIndexOf("Summary:"));
    return {
        I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(tail)?.[1]),
        TP: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail)?.[1]),
        LRA: Number(/LRA:\s+(-?[\d.]+) LU/.exec(tail)?.[1]),
    };
}

function build(t: "dark" | "light") {
    const { L: sL, R: sR, N, events, cuts, total } = synth(t);
    addIntroAndClosing(sL, sR, cuts);
    // master: every sound ends with the final fade to exact silence at the last frame
    const endSec = N / SR;
    const inter = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
        const b = Math.min(1, Math.max(0, (endSec - i / SR - 0.06) / FADE_OUT));
        const fo = b * b * (3 - 2 * b);
        inter[2 * i] = sL[i] * fo;
        inter[2 * i + 1] = sR[i] * fo;
    }
    const dir = path.resolve(__dirname, "public/tour/audio");
    const chartDir = path.resolve(__dirname, "out/tour/audio");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(chartDir, { recursive: true });
    const wav = path.join(dir, `tour-${t}.wav`);
    const r = ffRun(["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "2", "-i", "-", "-af", `volume=${SFX_GAIN_DB.toFixed(3)}dB,${LIMITER}`, "-c:a", "pcm_s16le", wav], Buffer.from(inter.buffer));
    if (r.status !== 0) throw new Error(`writing ${wav} failed: ${r.out}`);
    const loudness = measure(wav);
    fs.writeFileSync(
        path.join(chartDir, `tour-audio-${t}.json`),
        JSON.stringify({ theme: t, fps: FPS, total, gainDb: SFX_GAIN_DB, events, cuts, loudness, sceneIds: TOUR_SCENES.map((s) => s.id) }, null, 2),
    );
    console.log(`[audio:${t}] ${(N / SR).toFixed(2)}s, ${total} frames, ${events.length} event sounds, integrated ${loudness.I} LUFS, true peak ${loudness.TP} dBTP, LRA ${loudness.LRA} LU`);
}

for (const t of themes) build(t);
