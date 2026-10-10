// Draws a sync chart for the tour's sound design so the timing can be checked by eye:
// out/tour/audio/tour-audio-<theme>-chart.png has the RMS envelope of public/tour/audio/tour-<theme>.wav,
// a spectrogram (ffmpeg showspectrumpic), and markers aligned to the video frames:
// scene cuts (white lines, labelled) and every sound event (coloured by kind).
// Needs the audio and its JSON first (`audio:tour`) and a full ffmpeg (TM_FFMPEG, see generate-tour-audio.ts).
//
// Usage: pnpm --filter @tabmerger/demo audio:chart [dark|light]   (default: both)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const arg = process.argv[2] ?? "both";
const themes = arg === "both" ? ["dark", "light"] : [arg];
const FFMPEG = process.env.TM_FFMPEG ?? "ffmpeg";
const W = 2400;
const MARGIN = 60;

(async () => {
    const browser = await chromium.launch();
    for (const t of themes) {
        const wav = path.resolve(__dirname, `public/tour/audio/tour-${t}.wav`);
        const dir = path.resolve(__dirname, "out/tour/audio");
        const meta = JSON.parse(fs.readFileSync(path.join(dir, `tour-audio-${t}.json`), "utf-8"));
        const spec = path.join(dir, `tour-audio-${t}-spectrum.png`);
        const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-lavfi", `showspectrumpic=s=${W - 2 * MARGIN}x300:scale=log`, spec], { encoding: "utf-8" });
        if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
        // RMS envelope per 50 ms from the 16-bit stereo wav
        const buf = fs.readFileSync(wav);
        const data = buf.subarray(44);
        const n = data.length / 4;
        const hop = Math.round(0.05 * 44100);
        const rms: number[] = [];
        for (let i = 0; i + hop <= n; i += hop) {
            let sum = 0;
            for (let k = 0; k < hop; k++) {
                const l = data.readInt16LE((i + k) * 4) / 32768;
                sum += l * l;
            }
            rms.push(Math.sqrt(sum / hop));
        }
        const specB64 = fs.readFileSync(spec).toString("base64");
        const page = await browser.newPage({ viewport: { width: W, height: 820 } });
        // tsx injects a __name helper into serialised functions that does not exist in the page
        await page.addInitScript("window.__name = (f) => f;");
        await page.goto("about:blank");
        const png = await page.evaluate(
            async ({ rms, meta, specB64, W, MARGIN }) => {
                const H = 820;
                const c = document.createElement("canvas");
                c.width = W;
                c.height = H;
                const x = c.getContext("2d")!;
                x.fillStyle = "#101419";
                x.fillRect(0, 0, W, H);
                const total = meta.total as number;
                const px = (frame: number) => MARGIN + (frame / total) * (W - 2 * MARGIN);
                x.fillStyle = "#cfd6de";
                x.font = "20px sans-serif";
                x.fillText(`Tour sound design, ${meta.theme}: integrated ${meta.loudness.I} LUFS, true peak ${meta.loudness.TP} dBTP, LRA ${meta.loudness.LRA} LU. Markers are video frames (30 fps, ${total} total).`, MARGIN, 30);
                // envelope panel
                const ey = 60, eh = 260;
                x.fillStyle = "#1b222b";
                x.fillRect(MARGIN, ey, W - 2 * MARGIN, eh);
                x.fillStyle = "#6cc4ff";
                const max = Math.max(...rms, 0.001);
                rms.forEach((v, i) => {
                    const frame = (i * 0.05) * 30;
                    const h = (v / max) * (eh / 2 - 6);
                    x.fillRect(px(frame), ey + eh / 2 - h, Math.max(1, (W - 2 * MARGIN) / rms.length), h * 2);
                });
                // event sounds by kind
                const colors: Record<string, string> = { tick: "#ffd166", pluck: "#ff8fab", thump: "#ff6b6b", chime: "#95f0a7", swell: "#b79bff" };
                for (const e of meta.events as { frame: number; kind: string }[]) {
                    x.strokeStyle = colors[e.kind] ?? "#fff";
                    x.lineWidth = 2;
                    x.beginPath(); x.moveTo(px(e.frame), ey); x.lineTo(px(e.frame), ey + 40); x.stroke();
                }
                // cuts
                x.font = "16px sans-serif";
                (meta.cuts as number[]).forEach((cut, i) => {
                    x.strokeStyle = "#ffffff";
                    x.lineWidth = 2;
                    x.beginPath(); x.moveTo(px(cut), ey - 8); x.lineTo(px(cut), ey + eh + 8 + 330); x.stroke();
                    x.fillStyle = "#ffffff";
                    x.save();
                    x.translate(px(cut) + 4, ey + eh + 20);
                    x.rotate(Math.PI / 2);
                    x.fillText(`${meta.sceneIds[i]} @${cut}`, 0, 0);
                    x.restore();
                });
                // legend
                let lx = MARGIN;
                for (const [k, col] of Object.entries(colors)) {
                    x.fillStyle = col; x.fillRect(lx, 40, 14, 14);
                    x.fillStyle = "#cfd6de"; x.font = "16px sans-serif"; x.fillText(k, lx + 20, 52); lx += 110;
                }
                x.fillStyle = "#cfd6de"; x.fillText("white = scene cuts (content starts), coloured ticks = event sounds", lx + 10, 52);
                // spectrogram panel
                const img = new Image();
                img.src = "data:image/png;base64," + specB64;
                await img.decode();
                const sy = ey + eh + 100;
                x.drawImage(img, MARGIN, sy, W - 2 * MARGIN, 300);
                x.fillStyle = "#cfd6de";
                x.font = "16px sans-serif";
                x.fillText("spectrogram 0 to 22 kHz (log intensity, linear frequency axis)", MARGIN, sy - 8);
                for (const cut of meta.cuts as number[]) {
                    x.strokeStyle = "rgba(255,255,255,0.6)"; x.lineWidth = 1;
                    x.beginPath(); x.moveTo(px(cut), sy); x.lineTo(px(cut), sy + 300); x.stroke();
                }
                return c.toDataURL("image/png").split(",")[1];
            },
            { rms, meta, specB64, W, MARGIN },
        );
        fs.writeFileSync(path.join(dir, `tour-audio-${t}-chart.png`), Buffer.from(png, "base64"));
        console.log(`[audio:chart] ${path.join(dir, `tour-audio-${t}-chart.png`)}`);
        await page.close();
    }
    await browser.close();
})();
