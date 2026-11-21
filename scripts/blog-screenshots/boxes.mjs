// Annotation boxes for the blog screenshots, measured from the live DOM instead of by hand.
//
// Capture side (`recordBoxes`): right after a screenshot, read each target's bounding box with
// Playwright (`locator.boundingBox()`, which pierces the shadow DOM of chrome://settings pages) and
// write `<shot>.boxes.json` next to the PNG, in CSS pixels plus the device pixel ratio.
//
// Convert side (`toImageBoxes`): apply the same crop and scale convert.mjs applies to the pixels,
// add the padding, and express each box in % of the FINAL image, ready for the post's overlays.
import fs from 'fs';

/** Padding around every box, as a fraction of the final image width (12.8px on a 1600px image,
 *  which is 0.4rem of the 800px TabMerger popup at its real size). Same value on all four sides. */
export const PAD_FRACTION = 0.008;

/**
 * Runs in the page: the box around what an element visibly draws (its text, icons and coloured
 * leaf shapes such as a group's dot), walking into shadow roots and slots, instead of its full
 * layout box. Used with `fit: 'content'` for full-width rows that touch the image edge or their
 * neighbours (sidebar rows), where the layout box would make the annotation loose or clipped.
 * The element's own background (a selected row's highlight) is deliberately left out.
 */
function contentRect(root) {
  const rects = [];
  const add = (r) => { if (r.width > 0 && r.height > 0) rects.push(r); };
  const visit = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent.trim()) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) add(r);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
      const tag = node.localName;
      if (tag === 'svg' || tag === 'img' || tag === 'canvas' || tag === 'input') { add(node.getBoundingClientRect()); return; }
      if (tag === 'slot') { for (const n of node.assignedNodes({ flatten: true })) visit(n); return; }
      const leaf = node !== root && !node.shadowRoot && ![...node.childNodes].some((c) => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim()));
      const paints = cs.backgroundImage !== 'none' || (cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none') ||
        !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0;
      if (leaf && paints) { add(node.getBoundingClientRect()); return; }
    }
    for (const c of (node.shadowRoot ?? node).childNodes) visit(c);
  };
  visit(root);
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.left));
  const y = Math.min(...rects.map((r) => r.top));
  return { x, y, width: Math.max(...rects.map((r) => r.right)) - x, height: Math.max(...rects.map((r) => r.bottom)) - y };
}

/**
 * Measures `targets` on `page` and writes `<pngPath minus .png>.boxes.json`.
 * Each target: `{ id, label, locator, all?, each?, fit? }`, where `locator` is a Locator or an
 * array of them (the box is then their union, e.g. a strip's bars plus its hour labels). A locator
 * that matches several elements needs `all: true` (one box around every match) or `each: true`
 * (one box per match, ids `<id>-1`, `<id>-2`… in DOM order, labels `<label>: <element text>`);
 * otherwise it is an error, so a locator that became ambiguous fails loudly instead of boxing the
 * wrong thing. `fit: 'content'` measures what the element draws instead of its layout box
 * (see contentRect).
 */
export async function recordBoxes(page, pngPath, targets) {
  const sidecar = pngPath.replace(/\.png$/, '.boxes.json');
  fs.rmSync(sidecar, { force: true }); // never leave an older capture's boxes behind on failure
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const boxes = [];
  for (const t of targets) {
    const locators = Array.isArray(t.locator) ? t.locator : [t.locator];
    const rects = [];
    for (const loc of locators) {
      const n = await loc.count();
      if (n === 0) throw new Error(`box "${t.id}" in ${pngPath}: locator matched nothing`);
      if (n > 1 && !t.all && !t.each) throw new Error(`box "${t.id}" in ${pngPath}: locator matched ${n} elements (pass all: true or each: true)`);
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i);
        const b = t.fit === 'content' ? await el.evaluate(contentRect) : await el.boundingBox();
        if (!b || b.width === 0 || b.height === 0) throw new Error(`box "${t.id}" in ${pngPath}: element ${i} has no box (hidden?)`);
        rects.push({ ...b, text: t.each ? (await el.innerText()).trim() : '' });
      }
    }
    if (t.each) {
      rects.forEach((q, k) => boxes.push({ id: `${t.id}-${k + 1}`, label: `${t.label}: ${q.text}`, x: q.x, y: q.y, w: q.width, h: q.height }));
      continue;
    }
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    const r = Math.max(...rects.map((q) => q.x + q.width));
    const btm = Math.max(...rects.map((q) => q.y + q.height));
    boxes.push({ id: t.id, label: t.label, x, y, w: r - x, h: btm - y });
  }
  fs.writeFileSync(sidecar, JSON.stringify({ dpr, boxes }, null, 1));
  return boxes;
}

/**
 * Maps CSS-pixel boxes (`{ dpr, boxes }` from recordBoxes) onto the final image.
 * `crop` = [sx, sy, sw, sh] in source pixels (already clamped to the PNG), `outW`/`outH` = final
 * image size. Returns `[{ id, label, l, t, w, h }]` with "..%" strings, in reading order.
 */
export function toImageBoxes({ dpr, boxes }, crop, outW, outH) {
  const [sx, sy, sw, sh] = crop;
  const kx = outW / sw;
  const ky = outH / sh;
  const pad = PAD_FRACTION * outW;
  const clamp = (v, max) => Math.max(0, Math.min(max, v));
  const pct = (v) => `${(Math.round(v * 100) / 100).toFixed(2)}%`;
  const mapped = boxes.map((b) => {
    const left = clamp((b.x * dpr - sx) * kx - pad, outW);
    const top = clamp((b.y * dpr - sy) * ky - pad, outH);
    const right = clamp(((b.x + b.w) * dpr - sx) * kx + pad, outW);
    const bottom = clamp(((b.y + b.h) * dpr - sy) * ky + pad, outH);
    if (right - left < 1 || bottom - top < 1) throw new Error(`box "${b.id}" falls outside the crop`);
    return { id: b.id, label: b.label, left, top, right, bottom };
  });
  // Reading order: top to bottom, left to right for boxes that start on the same line (within 2%).
  mapped.sort((a, b) => (Math.abs(a.top - b.top) <= outH * 0.02 ? a.left - b.left : a.top - b.top));
  return mapped.map((m) => ({
    id: m.id,
    label: m.label,
    l: pct((m.left / outW) * 100),
    t: pct((m.top / outH) * 100),
    w: pct(((m.right - m.left) / outW) * 100),
    h: pct(((m.bottom - m.top) / outH) * 100),
  }));
}
