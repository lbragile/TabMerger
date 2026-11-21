// Draws boxes.json on top of the converted images so every box can be checked by eye:
//
//   node composite.mjs <out-dir> [image-dir] [boxes.json]
//
// Writes <stem>.png (the whole image with its numbered boxes) and <stem>--<id>.png (a 2x close-up
// of each box with some margin) to out-dir. Headless; nothing is written to the repo.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'packages', 'extension', 'package.json'));
const { chromium } = require('@playwright/test');

const SLUG = path.join('blog', 'save-all-open-tabs');
const [, , OUT, IMAGES = path.join(REPO, 'packages', 'web', 'public', SLUG), BOXES = path.join(REPO, 'packages', 'web', 'content', SLUG, 'boxes.json')] = process.argv;
if (!OUT) throw new Error('usage: node composite.mjs <out-dir> [image-dir] [boxes.json]');
fs.mkdirSync(OUT, { recursive: true });

const all = JSON.parse(fs.readFileSync(BOXES, 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const written = [];
for (const [stem, boxes] of Object.entries(all)) {
  const file = path.join(IMAGES, `${stem}.webp`);
  if (!fs.existsSync(file)) { console.warn(`missing image ${file}`); continue; }
  const b64 = fs.readFileSync(file).toString('base64');
  const overlays = boxes
    .map((b, i) => `<div class="box" style="left:${b.l};top:${b.t};width:${b.w};height:${b.h}"><span>${i + 1}</span></div>`)
    .join('');
  const html = `<!doctype html><style>
    body{margin:0;background:#888} #f{position:relative;display:inline-block;line-height:0}
    img{display:block}
    .box{position:absolute;box-sizing:border-box;border:2px solid #ff1f8f}
    .box span{position:absolute;left:-2px;top:-20px;background:#ff1f8f;color:#fff;font:bold 14px/18px sans-serif;padding:0 5px}
  </style><div id="f"><img src="data:image/webp;base64,${b64}">${overlays}</div>`;
  await page.setContent(html);
  await page.locator('img').evaluate((img) => img.decode());
  const { width, height } = await page.locator('img').evaluate((img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
  await page.setViewportSize({ width: width + 40, height: height + 40 });
  const whole = path.join(OUT, `${stem}.png`);
  await page.locator('#f').screenshot({ path: whole });
  written.push(whole);
  // Close-ups: 2x, with 60 image pixels of margin around each box.
  const zoom = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: width + 40, height: height + 40 } });
  await zoom.setContent(html);
  await zoom.locator('img').evaluate((img) => img.decode());
  for (const [i, b] of boxes.entries()) {
    const r = await zoom.locator('.box').nth(i).boundingBox();
    const x = Math.max(0, r.x - 60), y = Math.max(0, r.y - 60);
    const clip = { x, y, width: Math.min(width - x, r.width + 120), height: Math.min(height - y, r.height + 120) };
    const p = path.join(OUT, `${stem}--${b.id}.png`);
    await zoom.screenshot({ path: p, clip });
    written.push(p);
  }
  await zoom.close();
}
await browser.close();
console.log(written.join('\n'));
