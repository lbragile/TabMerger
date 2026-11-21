// Renders a blog post's social card (Open Graph / X image) once, at authoring time:
// packages/web/public/blog/<slug>/og.png, 1200×630 PNG. No request-time image route: the site
// serves this file as it is.
//
//   node scripts/blog-screenshots/og.mjs <slug> [screenshot-stem]
//
// The card: the site's dark theme, the post title large, its one-line `shareSummary`, the
// TabMerger logo and name, a cropped real screenshot from the post (default tm-merged-group, the
// dark capture) in a thin frame, and the three browser icons. Everything sits inside 64px margins
// (LinkedIn and X crop the edges a little) and stays readable at the ~500px feeds show it.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WEB = path.join(REPO, 'packages', 'web');
const require = createRequire(path.join(REPO, 'packages', 'extension', 'package.json'));
const { chromium } = require('@playwright/test');
const { readPostSummary } = await import(pathToFileURL(path.join(WEB, 'scripts', 'generate-blog-index.mjs')).href);

const slug = process.argv[2];
const stem = process.argv[3] ?? 'tm-merged-group';
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: node scripts/blog-screenshots/og.mjs <slug> [screenshot-stem]');
  process.exit(1);
}
const post = readPostSummary(fs.readFileSync(path.join(WEB, 'content', 'blog', slug, 'en.mdx'), 'utf8'));
const dir = path.join(WEB, 'public', 'blog', slug);
const shot = [`${stem}-dark.webp`, `${stem}.webp`].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
if (!post.title || !post.shareSummary || !shot) {
  console.error(`og: need a title, a shareSummary and public/blog/${slug}/${stem}(-dark).webp`);
  process.exit(1);
}
const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The browser marks used by the site's install buttons (components/marketing/BrowserIcons.tsx).
const ICONS = `
<svg width="40" height="40" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#4285F4"/><path d="M10 10 L10 1 A9 9 0 0 1 17.79 14.5 Z" fill="#EA4335"/><path d="M10 10 L17.79 14.5 A9 9 0 0 1 2.21 14.5 Z" fill="#FBBC05"/><path d="M10 10 L2.21 14.5 A9 9 0 0 1 10 1 Z" fill="#34A853"/><circle cx="10" cy="10" r="5.5" fill="white"/><circle cx="10" cy="10" r="3.8" fill="#4285F4"/></svg>
<svg width="40" height="40" viewBox="0 0 20 20"><path d="M10 1.5C5.3 1.5 1.5 5.3 1.5 10c0 4.7 3.8 8.5 8.5 8.5 2.1 0 4-.8 5.5-2H8.5C6.6 16.5 5 14.9 5 13s1.6-3.5 3.5-3.5H18c.3-.9.5-1.9.5-3 0-2.8-1.5-5.2-3.7-6.5-.6 1.1-.8 2.4-.5 3.7-1-1.2-1.5-2.8-1.3-4.2z" fill="#0078D4"/><path d="M14.8 4.2C13.4 2.6 11.3 1.5 10 1.5c-.5 1.3-.4 2.8.3 4 .5.8 1.3 1.4 2.2 1.5 1-.2 1.8-.7 2.3-1.5.1-.4.1-.9 0-1.3z" fill="#50E6FF"/><path d="M15.5 16c1.2-1.3 2-3 2-4.8v-.7H8.5c-1 0-2 .8-2 1.8 0 .6.3 1.1.7 1.4 1 .6 2.3.8 3.8.8 2 0 3.7-.5 4.5-1.3z" fill="#1DB5D5"/></svg>
<svg width="40" height="40" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#0060DF"/><path d="M10 1.5C9.4 1.5 8 1.8 7 2.5c.7.1 1.3.4 1.7.9C6.5 3.8 4.8 5.3 4 7c-.5 1-.7 2.1-.7 3.2 0 3.7 3 6.7 6.7 6.7s6.7-3 6.7-6.7c0-1.6-.6-3.2-1.6-4.4-.2.9-.7 1.7-1.4 2.2.1-.7.1-1.5-.1-2.2-.3-1-1-1.9-1.9-2.4-.4.8-.5 1.7-.3 2.6-.6-.5-1-1.2-1-2-.1-.4 0-.8.1-1.2L10 1.5z" fill="#FF9500"/><path d="M10.5 5.5c.3 1 .2 2.2-.4 3-.4.6-1 1-1.7 1.2-.3.1-.7.1-1 0-.2.7-.1 1.5.3 2.1.5.8 1.4 1.2 2.3 1.2 1.8 0 3.2-1.4 3.2-3.2 0-1.7-1-3.1-2.7-4.3z" fill="#FF4F00"/></svg>`;

// The dark theme's tokens (app/globals.css .dark): background, card, foreground, muted, primary.
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: Geist, system-ui, sans-serif;
    background: hsl(220 30% 7%); color: hsl(210 28% 94%); }
  .card { position: relative; width: 1200px; height: 630px; padding: 64px; display: grid;
    grid-template-columns: 560px 1fr; gap: 48px;
    background: radial-gradient(900px 500px at 100% 0%, hsl(193 85% 58% / 0.12), transparent 60%), hsl(220 30% 7%); }
  .brand { display: flex; align-items: center; gap: 14px; font-weight: 700; font-size: 30px; }
  .brand img { width: 44px; height: 44px; border-radius: 8px; }
  .eyebrow { margin-top: 36px; color: hsl(193 85% 58%); font-weight: 600; font-size: 24px; letter-spacing: 0.02em; }
  h1 { margin-top: 12px; font-size: 56px; line-height: 1.06; font-weight: 800; letter-spacing: -0.02em; }
  p { margin-top: 20px; font-size: 27px; line-height: 1.35; color: hsl(220 20% 71%); }
  .browsers { position: absolute; left: 64px; bottom: 64px; display: flex; gap: 14px; align-items: center; }
  .shot { align-self: center; border-radius: 14px; overflow: hidden; height: 470px;
    box-shadow: 0 0 0 1px hsl(220 16% 22%), 0 30px 60px -28px rgba(0,0,0,.85); }
  .shot img { display: block; width: 760px; height: auto; transform: translateX(-4px); }
</style></head><body><div class="card">
  <div>
    <div class="brand"><img src="${dataUrl(path.join(WEB, 'public', 'logo.png'), 'image/png')}" alt="">TabMerger</div>
    <div class="eyebrow">Guide</div>
    <h1>${escape(post.title)}</h1>
    <p>${escape(post.shareSummary)}</p>
  </div>
  <div class="shot"><img src="${dataUrl(shot, 'image/webp')}" alt=""></div>
  <div class="browsers">${ICONS}</div>
</div></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const out = path.join(dir, 'og.png');
await page.screenshot({ path: out, type: 'png' });
await browser.close();
const size = fs.statSync(out).size;
console.log(`${path.relative(REPO, out)}: 1200×630, ${Math.round(size / 1024)} KB`);
if (size >= 1024 * 1024) {
  console.error('og: the card is over 1 MB; use a smaller screenshot crop');
  process.exit(1);
}
