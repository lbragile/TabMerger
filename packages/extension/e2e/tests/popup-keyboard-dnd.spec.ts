import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedIdb } from '../helpers';
import { RawCdp } from '../rawCdp';

/**
 * Keyboard drag inside the REAL MV3 toolbar action popup (opened with
 * `chrome.action.openPopup()` and driven over raw CDP `Input.dispatchKeyEvent`, so focus
 * and key delivery are the popup's own). Covers: Enter is never a drag key, and every
 * arrow step lands on a real target with the ends clamping (no overshoot / wrap).
 * Headless (`--headless=new`), like the other real-popup specs.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = fs.existsSync(path.resolve(__dirname, '../../.output/chrome-mv3-dev'))
  ? path.resolve(__dirname, '../../.output/chrome-mv3-dev')
  : path.resolve(__dirname, '../../.output/chrome-mv3');
const CDP_PORT = 9450;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOW_OPEN = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const mkTab = (title: string) => ({ id: 0, title, url: `https://example.com/${title.toLowerCase()}` });
const WORK = {
  id: 'work',
  name: 'Work',
  windows: [{ id: 1, incognito: false, focused: false, tabs: [mkTab('Alpha'), mkTab('Bravo'), mkTab('Charlie')] }],
};
const PLAY = { id: 'play', name: 'Play', windows: [{ id: 2, incognito: false, focused: false, tabs: [mkTab('Foxtrot')] }] };

const KEYS = {
  Space: { key: ' ', vk: 32, text: ' ' },
  Enter: { key: 'Enter', vk: 13, text: '\r' },
  ArrowDown: { key: 'ArrowDown', vk: 40 },
  ArrowUp: { key: 'ArrowUp', vk: 38 },
  ArrowLeft: { key: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', vk: 39 },
  Escape: { key: 'Escape', vk: 27 },
} as const;

async function press(cdp: RawCdp, code: keyof typeof KEYS, ms = 200) {
  const k = KEYS[code] as { key: string; vk: number; text?: string };
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', code, key: k.key, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
    ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}),
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k.key, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk });
  await sleep(ms);
}

test('real popup: Enter is never a drag key; arrow navigation clamps at both ends in both panes', async () => {
  test.setTimeout(120_000);
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      '--headless=new',
      `--load-extension=${EXT}`,
      `--disable-extensions-except=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
    ],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = new URL(sw.url()).hostname;

    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
    await seedIdb(seedPage, [NOW_OPEN, WORK, PLAY]);
    await seedPage.close();

    const host = await context.newPage();
    await host.goto('about:blank');
    await host.bringToFront();
    await sw.evaluate(async () => {
      await chrome.action.openPopup();
    });

    const cdp = await RawCdp.attach(CDP_PORT, '/popup.html');
    try {
      await cdp.send('Runtime.enable');
      await expect
        .poll(() => cdp.evaluate<boolean>(`!![...document.querySelectorAll('span')].find(s => s.textContent === 'Work')`), { timeout: 5_000 })
        .toBe(true);
      await cdp.evaluate(`[...document.querySelectorAll('span')].find(s => s.textContent === 'Work').click()`);
      await expect
        .poll(() => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder tab"]').length`), { timeout: 5_000 })
        .toBe(3);

      const live = () => cdp.evaluate<string>(`(document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '')`);
      const pressed = () => cdp.evaluate<number>(`document.querySelectorAll('[aria-label^="Drag to reorder"][aria-pressed="true"]').length`);
      const focusRow = (title: string) => cdp.evaluate(`document.querySelector('[role="listitem"][aria-label="${title}"]').focus()`);
      const focusGrip = (title: string) =>
        cdp.evaluate(`document.querySelector('[role="listitem"][aria-label="${title}"] [aria-label^="Drag to reorder"]').focus()`);

      // Enter on the grip never starts a drag.
      await focusGrip('Alpha');
      await press(cdp, 'Enter');
      expect(await pressed()).toBe(0);

      // Space on the ROW picks up (the popup's own focus behaviour).
      await focusRow('Alpha');
      await press(cdp, 'Space');
      expect(await pressed()).toBe(1);

      // Main pane: 3 tabs + zone = 4 targets; N+3 downs. Every step distinct until the zone, then it stays.
      const down: string[] = [];
      for (let i = 0; i < 7; i++) { await press(cdp, 'ArrowDown'); down.push(await live()); }
      expect(down.slice(0, 3)).toEqual([
        'Over position 2 of 3 in Window 1 of group Work.',
        'Over position 3 of 3 in Window 1 of group Work.',
        'Over a new window at the end of group Work.',
      ]);
      expect(new Set(down.slice(2)).size).toBe(1);
      const up: string[] = [];
      for (let i = 0; i < 7; i++) { await press(cdp, 'ArrowUp'); up.push(await live()); }
      expect(up.slice(0, 3)).toEqual([
        'Over position 3 of 3 in Window 1 of group Work.',
        'Over position 2 of 3 in Window 1 of group Work.',
        'Over its original position.',
      ]);
      expect(new Set(up.slice(2)).size).toBe(1);

      // Sidebar: Now Open, Work, Play, "new group" = clamp at both ends.
      await press(cdp, 'ArrowLeft');
      expect(await live()).toMatch(/Over group Work, as a new window/);
      const sdown: string[] = [];
      for (let i = 0; i < 6; i++) { await press(cdp, 'ArrowDown'); sdown.push(await live()); }
      expect(sdown[0]).toBe('Over group Play, as a new window.');
      expect(sdown.slice(1).every((t) => t === 'Over a new group.')).toBe(true);
      const sup: string[] = [];
      for (let i = 0; i < 6; i++) { await press(cdp, 'ArrowUp'); sup.push(await live()); }
      expect(sup.slice(2).every((t) => /Over Now Open/.test(t))).toBe(true);

      // Enter mid-drag is ignored (used to DROP); the popup is alive; Escape cancels with nothing moved.
      await press(cdp, 'Enter');
      expect(await pressed()).toBe(1);
      await press(cdp, 'Escape');
      expect(await pressed()).toBe(0);
      expect(await cdp.evaluate<number>(`document.querySelectorAll('[role="listitem"][aria-label="Alpha"]').length`)).toBe(1);

      // Enter on the ROW still opens the tab (a new browser tab).
      const opened = context.waitForEvent('page', { timeout: 5_000 });
      await focusRow('Alpha');
      await press(cdp, 'Enter', 50).catch(() => {});
      const p = await opened;
      expect(p.url()).toContain('example.com/alpha');
    } finally {
      cdp.close();
    }
  } finally {
    await context.close();
  }
});
