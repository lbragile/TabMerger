// Crop + convert the raw PNG captures to WebP with Chromium's canvas encoder (no extra deps), and
// map each capture's measured annotation boxes (<name>.boxes.json, see boxes.mjs) onto the final
// image with the same crop and scale, into the post's boxes.json.
//
//   node convert.mjs <raw-dir> <out-dir> [boxes.json]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The repo root, from this file's place in it (scripts/blog-screenshots/).
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Playwright comes from the extension package (the repo root has no node_modules of its own).
const require = createRequire(path.join(REPO, 'packages', 'extension', 'package.json'));
const { chromium } = require('@playwright/test');
import { toImageBoxes } from './boxes.mjs';

const [, , IN, OUT, BOXES = path.join(REPO, 'packages', 'web', 'content', 'blog', 'save-all-open-tabs', 'boxes.json')] = process.argv;
fs.mkdirSync(OUT, { recursive: true });

// name -> [x, y, w, h] crop in source pixels (null = whole image), output max width
const CROPS = {
  'chrome-bookmarks-folder': [0, 0, 2200, 720],
  'chrome-history': [0, 0, 2200, 880],
  'chrome-startup-setting': [0, 0, 2200, 900],
  'edge-bookmarks-folder': [0, 0, 2200, 760],
  'edge-history': [0, 0, 2200, 840],
  'edge-startup-setting': [0, 0, 1760, 700],
  'firefox-startup': [0, 40, 940, 760],
};

// Captures with no DOM to measure (Firefox's own -screenshot): boxes measured by hand on the raw
// PNG, in its pixels (dpr 1), WITHOUT padding (toImageBoxes adds the same padding as everywhere).
// Re-measure whenever the capture changes, and check it on a composite (README, "Checking boxes").
const HAND_BOXES = {
  'firefox-startup': {
    dpr: 1,
    // The ticked checkbox and its label, measured on the 2026-11-19 capture.
    boxes: [{ id: 'startup-option', label: 'Open previous windows and tabs', x: 340, y: 387, w: 245, h: 19 }],
  },
};

const browser = await chromium.launch();
const allBoxes = fs.existsSync(BOXES) ? JSON.parse(fs.readFileSync(BOXES, 'utf8')) : {};
const page = await browser.newPage();
const report = [];
for (const file of fs.readdirSync(IN).filter((f) => f.endsWith('.png') && f !== 'firefox-prefs.png')) {
  const name = file.replace(/\.png$/, '');
  const b64 = fs.readFileSync(path.join(IN, file)).toString('base64');
  const crop = CROPS[name] ?? null;
  const maxW = name.startsWith('tm-') ? 1600 : 1600;
  const out = await page.evaluate(async ({ b64, crop, maxW }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const [sx, sy, sw, sh] = crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
    const w = Math.min(sw, img.naturalWidth - sx), h = Math.min(sh, img.naturalHeight - sy);
    const scale = Math.min(1, maxW / w);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, w, h, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/webp', 0.86).split(',')[1], w: c.width, h: c.height, crop: [sx, sy, w, h] };
  }, { b64, crop, maxW });
  const sidecar = path.join(IN, `${name}.boxes.json`);
  const measured = fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')) : HAND_BOXES[name];
  if (measured?.boxes.length) allBoxes[name] = toImageBoxes(measured, out.crop, out.w, out.h);
  const dest = path.join(OUT, `${name}.webp`);
  fs.writeFileSync(dest, Buffer.from(out.data, 'base64'));
  report.push(`${name}.webp ${out.w}x${out.h} ${Math.round(fs.statSync(dest).size / 1024)}KB`);
}
await browser.close();
fs.mkdirSync(path.dirname(BOXES), { recursive: true });
fs.writeFileSync(BOXES, `${JSON.stringify(Object.fromEntries(Object.keys(allBoxes).sort().map((k) => [k, allBoxes[k]])), null, 2)}\n`);
// Sizes go next to the raw captures (not into the public folder, where they would be served).
fs.writeFileSync(path.join(IN, 'sizes.json'), JSON.stringify(Object.fromEntries(report.map((r) => { const [f, d] = r.split(' '); const [w, h] = d.split('x').map(Number); return [f, { w, h }]; })), null, 1));
console.log(report.join('\n'));
