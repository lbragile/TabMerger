// Downloads the tour's music bed if it is not on disk: "Day Dreamin' with U" by Michael Ramir C., from Mixkit.
//
// License (Mixkit Stock Music Free License, https://mixkit.co/license/#musicFree): free for commercial use, including
// YouTube and online ads, no attribution required. NOT allowed: redistributing the track itself (so the MP3 is never
// committed: it lives under the gitignored public/tour/audio/), remixing it into a music-only track, or registering it
// with Content ID or similar fingerprinting systems.
//
// The file is checked against a SHA-256 so an upstream change cannot silently move the beat grid
// (MUSIC_FIRST_BEAT_SEC in remotion/tour/beatGrid.ts was measured on exactly this file).
//
// Usage: pnpm --filter @tabmerger/demo music:tour   (generate-tour-audio.ts also calls this when the file is missing)
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MUSIC_URL = "https://assets.mixkit.co/music/988/988.mp3";
export const MUSIC_SHA256 = "643509191c18481fea4a1ee620d4a02a5a7365d181d19fc7c48ab7ed219bab9c";
export const MUSIC_FILE = path.resolve(__dirname, "public/tour/audio/music/day-dreamin-with-u.mp3");

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Returns the path of the music file, downloading it first when it is missing (or its checksum is wrong). */
export async function ensureTourMusic(): Promise<string> {
    if (fs.existsSync(MUSIC_FILE) && sha(fs.readFileSync(MUSIC_FILE)) === MUSIC_SHA256) return MUSIC_FILE;
    console.log(`[music:tour] downloading ${MUSIC_URL}`);
    const res = await fetch(MUSIC_URL);
    if (!res.ok) throw new Error(`downloading the music failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== MUSIC_SHA256) throw new Error(`the downloaded file does not match the expected checksum (the track changed upstream?): ${sha(buf)}`);
    fs.mkdirSync(path.dirname(MUSIC_FILE), { recursive: true });
    fs.writeFileSync(MUSIC_FILE, buf);
    console.log(`[music:tour] saved ${MUSIC_FILE} (${(buf.length / 1e6).toFixed(1)} MB)`);
    return MUSIC_FILE;
}

if (require.main === module) {
    ensureTourMusic().then((f) => console.log(`[music:tour] ready: ${f}`), (e) => { console.error(e); process.exit(1); });
}
