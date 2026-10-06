// Renders Chrome Web Store listing assets from the existing pipeline:
//   - screenshots: composites each raw screenshots/raw/*.png (see
//     screenshots.ts) onto a branded 1280x800 canvas.
//   - promo tiles: static 440x280 / 1400x560 branded stills.
// All output as JPEG — sidesteps the "24-bit PNG, no alpha" requirement
// entirely since JPEG has no alpha channel.
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const ENTRY = path.resolve(__dirname, "remotion/Root.tsx");
const RAW_DIR = path.resolve(__dirname, "screenshots/raw");
const STORE_DIR = path.resolve(__dirname, "screenshots/store");
const PROMO_DIR = path.resolve(__dirname, "promo");
const PUBLIC_RAW_DIR = path.resolve(__dirname, "public/screenshots/raw");

async function main() {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.mkdirSync(PROMO_DIR, { recursive: true });

    // ponytail: staticFile() only serves from publicDir and rejects "../"
    // traversal, so raw screenshots (screenshots/raw/, a sibling of
    // public/) aren't directly reachable. Pointing publicDir at the whole
    // package root instead fails too — Remotion tries to copy node_modules
    // and hits Windows symlink EPERM. Mirror just the raw screenshots into
    // public/screenshots/raw/ instead.
    fs.rmSync(PUBLIC_RAW_DIR, { recursive: true, force: true });
    fs.mkdirSync(PUBLIC_RAW_DIR, { recursive: true });
    for (const file of fs.readdirSync(RAW_DIR)) {
        fs.copyFileSync(path.join(RAW_DIR, file), path.join(PUBLIC_RAW_DIR, file));
    }
    fs.copyFileSync(
        path.resolve(__dirname, "../extension/src/assets/logo.png"),
        path.resolve(__dirname, "public/logo.png"),
    );

    const serveUrl = await bundle(ENTRY);

    const screenshotIds = fs
        .readdirSync(RAW_DIR)
        .filter((f) => f.endsWith(".png"))
        .map((f) => f.replace(/\.png$/, ""));

    for (const screenshotId of screenshotIds) {
        const composition = await selectComposition({
            serveUrl,
            id: "ScreenshotFrame",
            inputProps: { screenshotId },
        });
        const outputLocation = path.join(STORE_DIR, `${screenshotId}.jpg`);
        await renderStill({
            composition,
            serveUrl,
            inputProps: { screenshotId },
            output: outputLocation,
            imageFormat: "jpeg",
            jpegQuality: 100,
        });
        console.log(`[store-assets] saved ${outputLocation}`);
    }

    for (const [id, filename] of [
        ["PromoSmall", "small-tile.jpg"],
        ["PromoMarquee", "marquee-tile.jpg"],
    ] as const) {
        const composition = await selectComposition({ serveUrl, id });
        const outputLocation = path.join(PROMO_DIR, filename);
        await renderStill({
            composition,
            serveUrl,
            output: outputLocation,
            imageFormat: "jpeg",
            jpegQuality: 100,
        });
        console.log(`[store-assets] saved ${outputLocation}`);
    }

    // 1280x640 social preview: PNG for crisp text; falls back to JPEG if the
    // PNG would reach 1 MB (GitHub's social preview limit).
    const social = await selectComposition({ serveUrl, id: "SocialPreview" });
    const socialPng = path.join(PROMO_DIR, "social-preview.png");
    const socialJpg = path.join(PROMO_DIR, "social-preview.jpg");
    fs.rmSync(socialJpg, { force: true });
    await renderStill({ composition: social, serveUrl, output: socialPng, imageFormat: "png" });
    if (fs.statSync(socialPng).size >= 1024 * 1024) {
        fs.rmSync(socialPng);
        await renderStill({ composition: social, serveUrl, output: socialJpg, imageFormat: "jpeg", jpegQuality: 92 });
        console.log(`[store-assets] saved ${socialJpg}`);
    } else {
        console.log(`[store-assets] saved ${socialPng}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
