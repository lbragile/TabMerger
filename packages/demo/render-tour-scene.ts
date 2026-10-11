// Renders ONE feature-tour scene to its own file, so a fix to a scene is
// re-rendered in seconds instead of re-rendering the whole tour.
//
// Usage (from anywhere): pnpm --filter @tabmerger/demo render:tour-scene <scene-id|number> [dark|light] [--frame=N]
//   render:tour-scene the-mess            -> out/tour/scene-01-the-mess-dark.mp4
//   render:tour-scene 1 light             -> out/tour/scene-01-the-mess-light.mp4
//   render:tour-scene the-mess --frame=60 -> out/tour/scene-01-the-mess-dark-f060.png (a still)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TOUR_SCENES, tourSceneCompositionId, tourSceneNumber } from "./remotion/tour/registry";

const args = process.argv.slice(2);
const frameArg = args.find((a) => a.startsWith("--frame="));
const positional = args.filter((a) => !a.startsWith("--"));
const [sceneArg, themeArg = "dark"] = positional;

const scene = TOUR_SCENES.find((s, i) => s.id === sceneArg || String(i + 1) === String(Number(sceneArg)));
if (!scene || (themeArg !== "dark" && themeArg !== "light")) {
    console.error(
        `Usage: render:tour-scene <scene-id|number> [dark|light] [--frame=N]\nScenes: ${TOUR_SCENES.map((s) => `${tourSceneNumber(s.id)} ${s.id}`).join(", ")}`,
    );
    process.exit(1);
}

const outDir = path.resolve(__dirname, "out/tour");
fs.mkdirSync(outDir, { recursive: true });
const base = `scene-${tourSceneNumber(scene.id)}-${scene.id}-${themeArg}`;
const compositionId = tourSceneCompositionId(scene.id, themeArg);
// shell:true (needed for `pnpm` on Windows) re-splits on spaces, so quote the path.
const q = (p: string) => `"${p}"`;
const cmd = frameArg
    ? ["still", compositionId, q(path.join(outDir, `${base}-f${frameArg.slice(8).padStart(3, "0")}.png`)), frameArg]
    : ["render", compositionId, q(path.join(outDir, `${base}.mp4`)), "--crf=16"];

const result = spawnSync("pnpm", ["exec", "remotion", cmd[0], "remotion/Root.tsx", ...cmd.slice(1)], {
    cwd: __dirname,
    stdio: "inherit",
    shell: true,
});
process.exit(result.status ?? 1);
