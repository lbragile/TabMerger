// Renders the feature tour's poster image (a still, not part of the video) at 1920x1080 and, with
// Remotion's --scale, at 1280x720.
//
// Usage: pnpm --filter @tabmerger/demo render:tour-thumbnail [dark|light]
//   -> out/tour/tabmerger-tour-thumbnail-dark.png and out/tour/tabmerger-tour-thumbnail-dark-1280.png
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const theme = process.argv[2] ?? "dark";
if (theme !== "dark" && theme !== "light") {
    console.error("Usage: render:tour-thumbnail [dark|light]");
    process.exit(1);
}
const outDir = path.resolve(__dirname, "out/tour");
fs.mkdirSync(outDir, { recursive: true });
// shell:true (needed for `pnpm` on Windows) re-splits on spaces, so quote the path.
const q = (p: string) => `"${p}"`;
const renders: { file: string; extra: string[] }[] = [
    { file: `tabmerger-tour-thumbnail-${theme}.png`, extra: [] },
    { file: `tabmerger-tour-thumbnail-${theme}-1280.png`, extra: ["--scale=0.6666667"] },
];
for (const { file, extra } of renders) {
    const result = spawnSync("pnpm", ["exec", "remotion", "still", "remotion/Root.tsx", `TourThumbnail-${theme}`, q(path.join(outDir, file)), ...extra], {
        cwd: __dirname,
        stdio: "inherit",
        shell: true,
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
