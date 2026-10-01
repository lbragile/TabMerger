import { test, expect } from '@playwright/test';
import {
  STANDARD_GROUPS, NOW_OPEN, grp, win, starredWin, openRealPopup, openGroup, ctrlSelect, walkUntil, rowLabel, groupRow, sleep, ghostOutside,
  type PopupSession, type SeedGroup, type Within,
} from '../kbdPopup';

// Cells are independent (each opens its own browser + popup), so let CI shards (--shard=i/N) split them.
test.describe.configure({ mode: 'parallel' });

/**
 * Keyboard MOVE MODE in the REAL toolbar popup (chrome.action.openPopup + raw CDP key
 * events): a matrix of the approved behaviour. Focus is always reached with the Tab key like
 * a user (never by focusing a grip). Each cell asserts the resulting data (IndexedDB / real
 * browser tabs), and prints a `CELL|name|PASS/FAIL|announcements` line for the report.
 *
 * Behaviour under test:
 *  - Space picks up (a selected row picks up the whole selection); Ctrl+Space toggles selection
 *    without moving or opening; Enter on a tab opens it and is inert during a move.
 *  - Up/Down walk the shown group and WRAP; Left enters the group list (the shown group follows
 *    the highlight, "New group" last); Right enters the highlighted group; Space drops (end of
 *    the highlighted group in the list); Escape restores the original group and focus.
 *  - the preview is the pointer's (collapsed source, insertion gap, docked copy) and the copy is
 *    always inside its scroll container's visible rect.
 */
const W = (n: number) => `Window ${n} controls`;
const WORK_DATA = [['Alpha', 'Bravo', 'Charlie'], ['Delta', 'Echo']];

/**
 * Did Enter open the saved "Bravo" tab? Checked through `chrome.tabs.query` in the service worker
 * (URL or pendingUrl) so it never waits on a real page load: the CI runner's access to example.com
 * is not something this test is about. Polls briefly because the tab is created asynchronously.
 */
async function tabOpened(s: PopupSession, log: (x: string) => void): Promise<boolean> {
  let urls: string[] = [];
  for (let i = 0; i < 20; i++) {
    urls = await s.tabUrls();
    if (urls.some((u) => u.includes('example.com/bravo'))) break;
    await sleep(250);
  }
  log('tabs=' + urls.join(','));
  return urls.some((u) => u.includes('example.com/bravo'));
}

async function cell(
  name: string,
  groups: SeedGroup[],
  opts: { liveWindows?: string[][]; timeout?: number },
  fn: (s: PopupSession, log: (x: string) => void) => Promise<boolean>
) {
  test(name, async () => {
    test.setTimeout(opts.timeout ?? 90_000);
    const s = await openRealPopup(groups, opts);
    const notes: string[] = [];
    let ok = false;
    try {
      ok = await fn(s, (x) => notes.push(x));
      // (the popup may have closed itself: opening a tab dismisses it)
      const snap = await Promise.race([s.snapshot().catch(() => null), sleep(3000).then(() => null)]);
      notes.push('final=' + (snap ? JSON.stringify(snap.groups) : 'popup closed'));
    } catch (e) {
      notes.push('ERROR ' + (e as Error).message.split('\n')[0]);
    } finally {
      console.log(`CELL|${name}|${ok ? 'PASS' : 'FAIL'}|${notes.join(' ;; ')}`);
      await s.close();
    }
    expect(ok, notes.join(' ;; ')).toBe(true);
  });
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const KNOWN = ['now-open', 'work', 'play', 'extra', 'quad'];
/** The id of the single group a "new group" drop created (seeded groups and the blank Now Open placeholder excluded). */
const created = (g: Record<string, string[][]>) => Object.keys(g).filter((k) => !KNOWN.includes(k) && !JSON.stringify(g[k]).includes('about:blank'));
const dropped = async (s: PopupSession, log: (x: string) => void) => {
  await s.press('Space');
  await sleep(450); // the outcome is announced ~150ms after focus lands
  log('drop=' + (await s.live()));
};
/** Press and let the smooth scroll + the copy's follow frames settle before measuring. */
const settle = (s: PopupSession, key: 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight') => s.press(key, { ms: 450 });
const hostFocused = (s: PopupSession) => s.eval<boolean>(`document.activeElement?.getAttribute('data-testid') === 'keyboard-move-host'`);
// (rows only: the docked copy is a clone of the source row and carries the attribute too, minus its row id)
const sourcesMarked = (s: PopupSession) => s.eval<number>(`document.querySelectorAll('[data-tm-dnd-id][data-tm-move-source]').length`);
const shownRows = (s: PopupSession) =>
  s.eval<string[]>(`[...document.querySelectorAll('[role="listitem"][data-tab-index]')].map(e => e.getAttribute('aria-label'))`);
const opacity = (s: PopupSession) => s.eval<string>(`getComputedStyle(document.querySelector('[data-testid="windows-panel-scroll"]')).opacity`);
const ghostCount = (s: PopupSession) => s.eval<number>(`document.querySelectorAll('#tm-dnd-aux-host [data-testid="drag-ghost"]').length`);

// ───────────────────────── pick-up and selection ─────────────────────────
const saved = async (s: PopupSession) => { await openGroup(s, 'Work'); await s.tabTo(rowLabel('Bravo')); };

cell('P1 Ctrl+Space toggles the row in/out of the selection: no move, nothing opened', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s);
  const pagesBefore = s.context.pages().length;
  await s.press('Space', { ctrl: true });
  const a = await s.live(); log('on=' + a);
  const moving = await s.eval<boolean>(`!!document.querySelector('[data-tm-move-source]') || document.activeElement?.getAttribute('data-testid') === 'keyboard-move-host'`);
  await s.press('Space', { ctrl: true });
  const b = await s.live(); log('off=' + b);
  return a === 'Selected. 1 tab selected.' && b === 'Deselected. nothing selected.' && !moving
    && s.context.pages().length === pagesBefore && eq((await s.snapshot()).groups.work, WORK_DATA);
});
cell('P2 Ctrl+Space two tabs, then Space on one picks up the WHOLE selection; the drop keeps it selected', STANDARD_GROUPS(), {}, async (s, log) => {
  await openGroup(s, 'Work');
  await s.tabTo(rowLabel('Alpha')); await s.press('Space', { ctrl: true });
  await s.tabTo(rowLabel('Bravo')); await s.press('Space', { ctrl: true });
  log('sel=' + await s.live());
  await s.press('Space'); const pick = await s.live(); log('pick=' + pick);
  const marked = await sourcesMarked(s);
  const badge = await s.eval<string>(`document.querySelector('#tm-dnd-aux-host [data-testid="drag-ghost-count"]')?.textContent ?? ''`);
  await s.press('ArrowDown'); await dropped(s, log);
  const live = await s.live();
  log(`marked=${marked} badge=${badge}`);
  return /^Picked up 2 tabs/.test(pick) && marked === 2 && badge === '+1' && /still selected/.test(live)
    && eq((await s.snapshot()).groups.work[0], ['Charlie', 'Alpha', 'Bravo']);
});
cell('P3 Space on an UNSELECTED row picks up only that row (the selection is dropped)', STANDARD_GROUPS(), {}, async (s, log) => {
  await openGroup(s, 'Work');
  await s.tabTo(rowLabel('Alpha')); await s.press('Space', { ctrl: true });
  await s.tabTo(rowLabel('Echo')); await s.press('Space');
  const pick = await s.live(); log('pick=' + pick);
  await s.press('ArrowUp'); await dropped(s, log);
  return /^Picked up tab Echo/.test(pick) && eq((await s.snapshot()).groups.work, [['Alpha', 'Bravo', 'Charlie'], ['Echo', 'Delta']]);
});
cell('P4 Ctrl+Space on a window title and on a group row toggles them too', STANDARD_GROUPS(), {}, async (s, log) => {
  await openGroup(s, 'Work');
  await s.tabTo(`el.getAttribute('aria-label') === ${JSON.stringify(W(1))}`);
  await s.press('Space', { ctrl: true }); const w = await s.live(); log('window=' + w);
  await s.press('Space', { ctrl: true });
  await s.tabTo(groupRow('Play')); await s.press('Space', { ctrl: true });
  const g = await s.live(); log('group=' + g);
  const moving = await s.eval<boolean>(`!!document.querySelector('[data-tm-move-source]')`);
  return w === 'Selected. 1 window selected.' && g === 'Selected. 1 group selected.' && !moving;
});
cell('P5 Enter on a tab still opens it (no move starts)', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Enter');
  return tabOpened(s, log);
});

// ───────────────────────── saved tab (Bravo) ─────────────────────────
cell('S1 saved tab reorder; the preview collapses the source and opens a gap; focus follows the item', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); log('pick=' + await s.live());
  const hostFocus = await hostFocused(s);
  await s.press('ArrowDown', { ms: 450 }); log('down=' + await s.live());
  // preview: source row collapsed, the end of Window 1's list opened by the gap, one docked copy
  const preview = await s.eval<{ h: number; pad: string }>(`(() => { const src = document.querySelector('[data-tm-move-source]'); const list = document.querySelector('[data-tm-dnd-list="work::w0"]'); return { h: src.getBoundingClientRect().height, pad: list.style.paddingBottom }; })()`);
  log('preview=' + JSON.stringify(preview) + ' ghosts=' + await ghostCount(s));
  await dropped(s, log);
  const f = await s.focused(); log('focus=' + f);
  return hostFocus && preview.h === 0 && preview.pad.includes('calc') && (await ghostCount(s)) === 0 && (await sourcesMarked(s)) === 0
    && eq((await s.snapshot()).groups.work, [['Alpha', 'Charlie', 'Bravo'], ['Delta', 'Echo']]) && f.startsWith('DIV Bravo');
});
cell('S2 saved tab other window: each stop announced, no ghost left behind', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space');
  const seen = await walkUntil(s, 'ArrowDown', /Window 2/); log('walk=' + seen.join(' | ')); await dropped(s, log);
  const w = (await s.snapshot()).groups.work; return w[1].includes('Bravo') && !w[0].includes('Bravo');
});
cell('S3 saved tab new-window zone (highlighted, grown to hold the copy)', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space');
  const seen = await walkUntil(s, 'ArrowDown', /new window/); log('walk=' + seen.join(' | ')); await sleep(450);
  const zone = await s.eval<{ h: number; cls: string; invisible: boolean }>(`(() => { const z = document.querySelector('[data-testid="new-window-dropzone"]'); return { h: z.getBoundingClientRect().height, cls: z.className, invisible: z.className.includes('invisible') }; })()`);
  const out = await ghostOutside(s, ['panel', 'zone:new-window']); log('zone=' + JSON.stringify(zone) + ' outside=' + out.join(','));
  await dropped(s, log);
  return !zone.invisible && zone.h >= 72 && zone.cls.includes('bg-primary/10') && out.length === 0
    && eq((await s.snapshot()).groups.work, [['Alpha', 'Charlie'], ['Delta', 'Echo'], ['Bravo']]);
});
cell('S3b Down WRAPS from the last stop to the top; Up WRAPS from the top to the new-window zone', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space');
  const down = await walkUntil(s, 'ArrowDown', /new window/); await s.press('ArrowDown');
  const wrapDown = await s.live(); log('wrapDown=' + wrapDown);
  await s.press('ArrowUp'); // back to the zone
  const wrapUp = await s.live(); log('wrapUp=' + wrapUp);
  await s.press('ArrowDown'); await s.press('ArrowUp'); // top, then wrapped to the bottom again
  await dropped(s, log);
  return down.length > 0 && wrapDown.startsWith('Wrapped to top.') && /first in Window 1/.test(wrapDown)
    && wrapUp.startsWith('Wrapped to bottom.') && /new window/.test(wrapUp)
    && eq((await s.snapshot()).groups.work, [['Alpha', 'Charlie'], ['Delta', 'Echo'], ['Bravo']]);
});
cell('S4 Left enters the group list (shown group = highlight); Down -> Play; Space drops at the END of Play', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await settle(s, 'ArrowLeft'); const left = await s.live(); log('left=' + left);
  const ring = await s.eval<string>(`document.querySelector('[data-tm-move-cursor]')?.getAttribute('aria-label') ?? ''`);
  await settle(s, 'ArrowDown'); const down = await s.live(); log('down=' + down);
  const rows = await shownRows(s); log('shown=' + rows.join(','));
  const out = await ghostOutside(s, ['panel', 'list:play::w0']); log('outside=' + out.join(','));
  await dropped(s, log);
  const g = (await s.snapshot()).groups; const f = await s.focused(); log('focus=' + f);
  const after = await shownRows(s);
  return left === 'Group list: Work' && ring === 'Work' && down === 'Group list: Play' && rows.includes('Foxtrot') && !rows.includes('Alpha')
    && out.length === 0 && eq(g.play, [['Foxtrot', 'Bravo']]) && eq(g.work, [['Alpha', 'Charlie'], ['Delta', 'Echo']])
    && after.includes('Bravo') && after.includes('Foxtrot') && f.startsWith('DIV Bravo');
});
cell('S4b Right enters the highlighted group (item already at its end), then Up/Down walk THAT group', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await s.press('ArrowLeft'); await s.press('ArrowDown');
  await s.press('ArrowRight'); const entered = await s.live(); log('entered=' + entered);
  const ring = await s.eval<boolean>(`!!document.querySelector('[data-tm-move-cursor]')`);
  await s.press('ArrowUp'); const up = await s.live(); log('up=' + up);
  await dropped(s, log);
  return entered === 'Play: Bravo, last in Window 1' && !ring && up === 'Bravo, first in Window 1'
    && eq((await s.snapshot()).groups.play, [['Bravo', 'Foxtrot']]);
});
cell('S4c Right does nothing in the main panel; Left does nothing in the list', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await s.press('ArrowDown');
  const a = await s.live(); await s.press('ArrowRight'); const b = await s.live();
  await s.press('ArrowLeft'); const inList = await s.live(); await s.press('ArrowLeft'); const again = await s.live();
  log(`main=${a}|${b} list=${inList}|${again}`);
  await s.press('Escape');
  return a === b && inList === again && /^Group list/.test(inList);
});
cell('S4d list Up/Down wrap and end with "New group"; the shown group follows each stop', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await s.press('ArrowLeft');
  await s.press('ArrowUp'); const nowOpen = await s.live();
  await s.press('ArrowUp'); const wrapped = await s.live();
  await s.press('ArrowDown'); const back = await s.live();
  log(`${nowOpen} | ${wrapped} | ${back}`);
  await s.press('Escape');
  return nowOpen === 'Group list: Now Open' && wrapped === 'Wrapped to bottom. Group list: New group' && back === 'Wrapped to top. Group list: Now Open';
});
cell('S5 saved tab "New group": the shown group dims, the copy docks in the zone, Space creates the group', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await s.press('ArrowLeft');
  const notDimmed = await opacity(s);
  const seen = await walkUntil(s, 'ArrowDown', /New group/); log('walk=' + seen.join(' | ')); await sleep(500);
  const dim = await opacity(s);
  const out = await ghostOutside(s, ['sidebar', 'zone:new-group']);
  const zone = await s.eval<{ cls: string; h: number }>(`(() => { const z = document.querySelector('[data-testid="new-group-dropzone"]'); return { cls: z.className, h: z.getBoundingClientRect().height }; })()`);
  log(`dim=${dim} (was ${notDimmed}) outside=${out.join(',')} zone=${JSON.stringify(zone)}`);
  await s.press('ArrowRight'); const right = await s.live(); log('right=' + right); // Right on "New group": nothing
  await dropped(s, log);
  const g = (await s.snapshot()).groups; const c = created(g);
  return notDimmed === '1' && dim === '0.4' && out.length === 0 && !zone.cls.includes('invisible') && zone.h >= 72 && right === 'Group list: New group'
    && c.length === 1 && eq(g[c[0]], [['Bravo']]) && !g.work[0].includes('Bravo');
});
cell('S6 Escape from ANOTHER group: nothing moves, the original group is shown again, focus back on the source row', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await settle(s, 'ArrowLeft'); await settle(s, 'ArrowDown'); await settle(s, 'ArrowDown');
  log('at=' + await s.live() + ' shown=' + (await shownRows(s)).join(','));
  await s.press('Escape', { ms: 450 }); log('esc=' + await s.live());
  const f = await s.focused(); log('focus=' + f);
  const rows = await shownRows(s);
  return eq((await s.snapshot()).groups.work, WORK_DATA) && rows.includes('Alpha') && !rows.includes('Golf') && f.startsWith('DIV Bravo')
    && (await sourcesMarked(s)) === 0 && (await ghostCount(s)) === 0 && !(await s.eval<boolean>(`!!document.querySelector('[data-tm-move-cursor]')`));
});
cell('S7 Escape within the group: nothing moves, focus back on the source row', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await s.press('ArrowDown'); await s.press('ArrowDown'); log('at=' + await s.live()); await s.press('Escape'); log('esc=' + await s.live());
  const f = await s.focused(); log('focus=' + f);
  return eq((await s.snapshot()).groups.work, WORK_DATA) && f.startsWith('DIV') && f.includes('Bravo');
});

// ───────────────────────── several selected tabs (Alpha, Bravo) ─────────────────────────
const multi = async (s: PopupSession) => { await openGroup(s, 'Work'); await ctrlSelect(s, ['Alpha', 'Bravo']); await s.tabTo(rowLabel('Bravo')); };
cell('M1 several tabs reorder (selection kept)', STANDARD_GROUPS(), {}, async (s, log) => {
  await multi(s); await s.press('Space'); log('pick=' + await s.live()); await s.press('ArrowDown'); log('down=' + await s.live()); await dropped(s, log);
  return eq((await s.snapshot()).groups.work[0], ['Charlie', 'Alpha', 'Bravo']);
});
cell('M2 several tabs other window', STANDARD_GROUPS(), {}, async (s, log) => {
  await multi(s); await s.press('Space'); const seen = await walkUntil(s, 'ArrowDown', /Window 2/); log('walk=' + seen.join(' | ')); await dropped(s, log);
  const w = (await s.snapshot()).groups.work; return w[1].includes('Alpha') && w[1].includes('Bravo') && eq(w[0], ['Charlie']);
});
cell('M3 several tabs new-window zone', STANDARD_GROUPS(), {}, async (s, log) => {
  await multi(s); await s.press('Space'); const seen = await walkUntil(s, 'ArrowDown', /new window/); log('walk=' + seen.join(' | ')); await dropped(s, log);
  return eq((await s.snapshot()).groups.work, [['Charlie'], ['Delta', 'Echo'], ['Alpha', 'Bravo']]);
});
cell('M4 several tabs Left -> Play: dropped at the END of Play', STANDARD_GROUPS(), {}, async (s, log) => {
  await multi(s); await s.press('Space'); await s.press('ArrowLeft'); await s.press('ArrowDown'); log('at=' + await s.live()); await dropped(s, log);
  const g = (await s.snapshot()).groups; return eq(g.play, [['Foxtrot', 'Alpha', 'Bravo']]) && eq(g.work, [['Charlie'], ['Delta', 'Echo']]);
});
cell('M5 several tabs "New group"', STANDARD_GROUPS(), {}, async (s, log) => {
  await multi(s); await s.press('Space'); await s.press('ArrowLeft'); const seen = await walkUntil(s, 'ArrowDown', /New group/); log('walk=' + seen.join(' | ')); await dropped(s, log);
  const g = (await s.snapshot()).groups; const c = created(g);
  return c.length === 1 && eq(g[c[0]], [['Alpha', 'Bravo']]);
});
cell('M6 several tabs Escape', STANDARD_GROUPS(), {}, async (s, log) => {
  await multi(s); await s.press('Space'); await s.press('ArrowDown'); await s.press('Escape'); log('focus=' + await s.focused());
  return eq((await s.snapshot()).groups.work, WORK_DATA);
});

// ───────────────────────── window (Window 1 title) ─────────────────────────
const winHeader = async (s: PopupSession) => { await openGroup(s, 'Work'); await s.tabTo(`el.getAttribute('aria-label') === ${JSON.stringify(W(1))}`); };
cell('W1 window reorder; Down again WRAPS back to the origin slot', STANDARD_GROUPS(), {}, async (s, log) => {
  await winHeader(s); await s.press('Space'); log('pick=' + await s.live()); await s.press('ArrowDown'); log('down=' + await s.live());
  await s.press('ArrowDown'); const wrapped = await s.live(); log('wrap=' + wrapped); await s.press('ArrowDown');
  await dropped(s, log);
  return wrapped.startsWith('Wrapped to top.') && eq((await s.snapshot()).groups.work, [['Delta', 'Echo'], ['Alpha', 'Bravo', 'Charlie']]);
});
cell('W2 starred windows stay in the starred zone (and wrap there)', [NOW_OPEN, grp('work', 'Work', starredWin(1, 'A'), starredWin(2, 'B'), win(3, 'C')), grp('play', 'Play', win(4, 'Foxtrot'))], {}, async (s, log) => {
  await openGroup(s, 'Work'); await s.tabTo(`el.getAttribute('aria-label') === ${JSON.stringify(W(1))}`);
  await s.press('Space'); await s.press('ArrowDown'); const a = await s.live(); await s.press('ArrowDown'); const wrap = await s.live();
  log(`${a} | ${wrap}`); await s.press('ArrowDown'); await dropped(s, log);
  return /last in Work/.test(a) && wrap.startsWith('Wrapped to top.') && eq((await s.snapshot()).groups.work, [['B'], ['A'], ['C']]);
});
cell('W4 window Left -> Play appends it at the END of Play', STANDARD_GROUPS(), {}, async (s, log) => {
  await winHeader(s); await s.press('Space'); await s.press('ArrowLeft'); await s.press('ArrowDown'); log('at=' + await s.live()); await dropped(s, log);
  const g = (await s.snapshot()).groups; return eq(g.play, [['Foxtrot'], ['Alpha', 'Bravo', 'Charlie']]) && eq(g.work, [['Delta', 'Echo']]);
});
cell('W5 window "New group"', STANDARD_GROUPS(), {}, async (s, log) => {
  await winHeader(s); await s.press('Space'); await s.press('ArrowLeft'); const seen = await walkUntil(s, 'ArrowDown', /New group/); log('walk=' + seen.join(' | ')); await dropped(s, log);
  const g = (await s.snapshot()).groups; const c = created(g);
  return c.length === 1 && eq(g[c[0]], [['Alpha', 'Bravo', 'Charlie']]) && eq(g.work, [['Delta', 'Echo']]);
});
cell('W6 window Escape', STANDARD_GROUPS(), {}, async (s, log) => {
  await winHeader(s); await s.press('Space'); await s.press('ArrowDown'); await s.press('Escape'); const f = await s.focused(); log('focus=' + f);
  return eq((await s.snapshot()).groups.work, WORK_DATA) && f.includes('Window 1');
});

// ───────────────────────── group (Work sidebar row) ─────────────────────────
const workRow = async (s: PopupSession) => { await s.tabTo(groupRow('Work')); };
async function ctrlSelectGroups(s: PopupSession, names: string[]) {
  for (const n of names) {
    await s.eval(`(() => { const el = [...document.querySelectorAll('[data-sidebar-group-index]')].find(e => e.getAttribute('aria-label') === ${JSON.stringify(n)}); el.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true })); })()`);
    await sleep(150);
  }
}
cell('G1 group reorder', STANDARD_GROUPS(), {}, async (s, log) => {
  await workRow(s); await s.press('Space'); log('pick=' + await s.live()); await s.press('ArrowDown'); log('down=' + await s.live()); await dropped(s, log);
  return eq((await s.snapshot()).order.slice(1, 4), ['play', 'work', 'extra']);
});
cell('G2 group Up from the first saved group WRAPS to the bottom, one more Up lands above the last; never above Now Open', STANDARD_GROUPS(), {}, async (s, log) => {
  await workRow(s); await s.press('Space'); await s.press('ArrowUp'); const wrapped = await s.live(); await s.press('ArrowUp'); log(`wrap=${wrapped} up=${await s.live()}`); await dropped(s, log);
  const order = (await s.snapshot()).order;
  // order[0] is Now Open (the live group the extension owns): it stays first
  return wrapped.startsWith('Wrapped to bottom.') && order.length === 5 && eq(order.slice(1), ['play', 'extra', 'work', 'quad']);
});
cell('G3 group Down from the last WRAPS to the origin; Escape restores the order and focus', STANDARD_GROUPS(), {}, async (s, log) => {
  await workRow(s); await s.press('Space');
  await walkUntil(s, 'ArrowDown', /last/); await s.press('ArrowDown'); const wrapped = await s.live(); log('wrap=' + wrapped);
  await s.press('Escape'); const f = await s.focused(); log('focus=' + f);
  return wrapped.startsWith('Wrapped to top.') && /original position/.test(wrapped) && eq((await s.snapshot()).order.slice(1, 3), ['work', 'play']) && f.includes('Work');
});
cell('G6 group Escape', STANDARD_GROUPS(), {}, async (s, log) => {
  await workRow(s); await s.press('Space'); await s.press('ArrowDown'); await s.press('Escape'); const f = await s.focused(); log('focus=' + f);
  return eq((await s.snapshot()).order.slice(1, 3), ['work', 'play']) && f.includes('Work');
});
cell('G7 group Left/Right do nothing and a group is never offered the "New group" stop', STANDARD_GROUPS(), {}, async (s, log) => {
  await workRow(s); await s.press('Space');
  const a = await s.live(); await s.press('ArrowLeft'); await s.press('ArrowRight'); const b = await s.live();
  const walk = await walkUntil(s, 'ArrowDown', /New group/, 8); log('walk=' + walk.join(' | '));
  await s.press('Escape');
  return a === b && !walk.some((t) => /New group/i.test(t));
});
cell('MG1 several groups reorder as one block', STANDARD_GROUPS(), {}, async (s, log) => {
  await ctrlSelectGroups(s, ['Work', 'Play']); await workRow(s); await s.press('Space'); log('pick=' + await s.live()); await s.press('ArrowDown'); log('down=' + await s.live()); await dropped(s, log);
  return eq((await s.snapshot()).order.slice(1, 4), ['extra', 'work', 'play']);
});
cell('MG6 several groups Escape', STANDARD_GROUPS(), {}, async (s) => {
  await ctrlSelectGroups(s, ['Work', 'Play']); await workRow(s); await s.press('Space'); await s.press('ArrowDown'); await s.press('Escape');
  return eq((await s.snapshot()).order.slice(1, 4), ['work', 'play', 'extra']);
});

// ───────────────────────── Now Open tabs (live) ─────────────────────────
const LIVE = { liveWindows: [['live1', 'live2', 'live3'], ['live4', 'live5']] };
const nowOpen = async (s: PopupSession) => { await openGroup(s, 'Now Open'); await s.tabTo(rowLabel('Live2')); };
const liveTabs = (s: PopupSession) => s.sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => /127\.0\.0\.1/.test(t.url ?? '')).map((t) => `${t.url!.split('/').pop()}@${t.windowId}#${t.index}`));
cell('N1 Now Open tab reorder (a real tab moves)', [...STANDARD_GROUPS()], LIVE, async (s, log) => {
  const before = await liveTabs(s); log('before=' + before.join(','));
  await nowOpen(s); await s.press('Space'); log('pick=' + await s.live()); await s.press('ArrowDown'); log('down=' + await s.live()); await dropped(s, log); await sleep(500);
  const after = await liveTabs(s); log('after=' + after.join(','));
  return JSON.stringify(before) !== JSON.stringify(after);
});
cell('N2 Now Open tab other window (the real tab changes window)', [...STANDARD_GROUPS()], LIVE, async (s, log) => {
  const before = await liveTabs(s); log('before=' + before.join(','));
  await nowOpen(s); await s.press('Space'); const seen = await walkUntil(s, 'ArrowDown', /first in Window/, 10); log('walk=' + seen.join(' | ')); await dropped(s, log); await sleep(600);
  const after = await liveTabs(s); log('after=' + after.join(','));
  const w = (n: string[]) => n.find((x) => x.startsWith('live2'))!.split('@')[1].split('#')[0];
  return w(before) !== w(after);
});
cell('N3 Now Open tab new-window zone (a new real window)', [...STANDARD_GROUPS()], LIVE, async (s, log) => {
  await nowOpen(s); await s.press('Space'); const seen = await walkUntil(s, 'ArrowDown', /new window/, 10); log('walk=' + seen.join(' | ')); await dropped(s, log); await sleep(700);
  const after = await liveTabs(s); log('after=' + after.join(','));
  const wins = new Set(after.map((x) => x.split('@')[1].split('#')[0])); return wins.size === 3;
});
cell('N4 Now Open tab Left -> Work (the list starts on Now Open): saved at the END of Work, the real tab closes', [...STANDARD_GROUPS()], LIVE, async (s, log) => {
  await nowOpen(s); await s.press('Space'); await s.press('ArrowLeft'); const left = await s.live(); log('left=' + left); await s.press('ArrowDown'); const down = await s.live(); log('down=' + down); await dropped(s, log); await sleep(700);
  const after = await liveTabs(s); log('after=' + after.join(','));
  const g = (await s.snapshot()).groups;
  return left === 'Group list: Now Open' && down === 'Group list: Work' && !after.some((x) => x.startsWith('live2')) && eq(g.work, [['Alpha', 'Bravo', 'Charlie'], ['Delta', 'Echo', 'Live2']]);
});
cell('N5 Now Open tab "New group": group created, the real tab closes', [...STANDARD_GROUPS()], LIVE, async (s, log) => {
  await nowOpen(s); await s.press('Space'); await s.press('ArrowLeft'); const seen = await walkUntil(s, 'ArrowDown', /New group/); log('walk=' + seen.join(' | ')); await dropped(s, log); await sleep(700);
  const after = await liveTabs(s); log('after=' + after.join(','));
  const g = (await s.snapshot()).groups; const c = created(g);
  return !after.some((x) => x.startsWith('live2')) && c.length === 1 && eq(g[c[0]], [['Live2']]);
});
cell('N6 Now Open tab Escape (no real tab moves)', [...STANDARD_GROUPS()], LIVE, async (s, log) => {
  const before = await liveTabs(s);
  await nowOpen(s); await s.press('Space'); await s.press('ArrowDown'); await s.press('Escape'); const f = await s.focused(); log('focus=' + f);
  return JSON.stringify(before) === JSON.stringify(await liveTabs(s)) && f.startsWith('DIV') && f.includes('Live2');
});

// ───────────────────────── Enter / Tab are inert during a move ─────────────────────────
cell('E1 Enter and Tab are inert while moving (no drop, no open, focus stays on the host); Enter opens a tab outside a move', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await s.press('ArrowDown');
  const pagesBefore = s.context.pages().length;
  await s.press('Enter'); await s.press('Tab'); await s.press('Tab', { shift: true });
  const still = (await sourcesMarked(s)) === 1 && (await hostFocused(s));
  log('stillMoving=' + still);
  const unchanged = eq((await s.snapshot()).groups.work, WORK_DATA) && s.context.pages().length === pagesBefore;
  await s.press('Escape');
  const idle = (await sourcesMarked(s)) === 0 && (await ghostCount(s)) === 0;
  await s.press('Enter');
  const opened = await tabOpened(s, log);
  return still && unchanged && idle && opened;
});
cell('E2 Enter and Tab are inert in the group list too', STANDARD_GROUPS(), {}, async (s, log) => {
  await saved(s); await s.press('Space'); await s.press('ArrowLeft'); await s.press('ArrowDown');
  const at = await s.live(); await s.press('Enter'); await s.press('Tab'); const after = await s.live();
  log(`${at} | ${after}`);
  // (the source row's group is not the shown one here, so assert the move is still live through the host + copy)
  const still = (await ghostCount(s)) === 1 && (await hostFocused(s));
  await s.press('Escape');
  return at === after && still && eq((await s.snapshot()).groups.work, WORK_DATA);
});

// ───────────────────────── other conditions ─────────────────────────
cell('X2 search filter active: reorder visible tab', STANDARD_GROUPS(), {}, async (s, log) => {
  await openGroup(s, 'Work');
  await s.eval(`document.querySelector('[aria-label="Open search"]').click()`); await sleep(300);
  await s.cdp.send('Input.insertText', { text: 'ra' }); await sleep(300); await s.press('Escape'); await sleep(400);
  log('rows=' + (await shownRows(s)).join(','));
  await s.tabTo(rowLabel('Bravo')); await s.press('Space'); await s.press('ArrowDown'); log('down=' + await s.live()); await dropped(s, log);
  const w = (await s.snapshot()).groups.work; return w.flat().length === 5;
});
cell('X3 single-window group: tab to new-window zone', STANDARD_GROUPS(), {}, async (s, log) => {
  await openGroup(s, 'Play'); await s.tabTo(rowLabel('Foxtrot')); await s.press('Space');
  const seen = await walkUntil(s, 'ArrowDown', /new window/); log('walk=' + seen.join(' | ')); await dropped(s, log);
  return eq((await s.snapshot()).groups.play, [[], ['Foxtrot']]);
});
cell('X4 empty window is a stop of its own: the tab moves into it', [NOW_OPEN, grp('work', 'Work', win(1, 'Alpha', 'Bravo'), win(2)), grp('play', 'Play', win(3, 'Foxtrot'))], {}, async (s, log) => {
  await openGroup(s, 'Work'); await s.tabTo(rowLabel('Bravo')); await s.press('Space');
  const seen = await walkUntil(s, 'ArrowDown', /Window 2, empty/); log('walk=' + seen.join(' | '));
  const out = await ghostOutside(s, ['panel']); log('outside=' + out.join(','));
  await dropped(s, log);
  const w = (await s.snapshot()).groups.work; return /Window 2, empty/.test(seen[seen.length - 1] ?? '') && out.length === 0 && w.length >= 2 && eq(w[1], ['Bravo']);
});

// ───────────────────────── the copy is always visible ─────────────────────────
const LONG = grp('long', 'Long', win(9, ...Array.from({ length: 30 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`)));
const LONG_GROUPS = [NOW_OPEN, LONG, grp('play', 'Play', win(3, 'Foxtrot'))];
cell('V1 30-tab group: at EVERY stop (Down a full lap through the wrap, then Up a full lap) the copy is inside the panel and the window list', LONG_GROUPS, { timeout: 240_000 }, async (s, log) => {
  await openGroup(s, 'Long'); await s.tabTo(rowLabel('T15')); await s.press('Space');
  const failures: string[] = [];
  const stops = 31; // 29 other tabs + origin = 30 slots, + the new-window zone
  for (const key of ['ArrowDown', 'ArrowUp'] as const) {
    for (let i = 0; i < stops + 1; i++) {
      await s.press(key, { ms: 450 });
      const text = await s.live();
      const within: Within[] = /in a new window/.test(text) ? ['panel', 'zone:new-window'] : ['panel', 'list:long::w0'];
      const out = await ghostOutside(s, within);
      if (out.length) failures.push(`${key}#${i} "${text}": ${out.join(';')}`);
    }
  }
  log('failures=' + (failures.length ? failures.slice(0, 6).join(' || ') : 'none'));
  await s.press('Escape');
  return failures.length === 0 && eq((await s.snapshot()).groups.long[0].length, 30);
});
cell('V2 group list over a long group: the copy at the END of the 30-tab group is visible', LONG_GROUPS, { timeout: 120_000 }, async (s, log) => {
  await openGroup(s, 'Play'); await s.tabTo(rowLabel('Foxtrot')); await s.press('Space'); await settle(s, 'ArrowLeft');
  const seen: string[] = [];
  for (let i = 0; i < 4 && !/Long/.test(seen[seen.length - 1] ?? ''); i++) { await settle(s, 'ArrowUp'); seen.push(await s.live()); }
  log('walk=' + seen.join(' | ')); await sleep(300);
  const out = await ghostOutside(s, ['panel', 'list:long::w0']); log('outside=' + out.join(','));
  await dropped(s, log);
  const g = (await s.snapshot()).groups;
  return out.length === 0 && eq(g.long[0].slice(-2), ['T30', 'Foxtrot']);
});
const MANY = [NOW_OPEN, ...Array.from({ length: 16 }, (_, i) => grp(`g${String(i + 1).padStart(2, '0')}`, `G${String(i + 1).padStart(2, '0')}`, win(20 + i, `Tab${i + 1}`)))];
cell('V3 long sidebar (16 groups): at every stop of a group move the copy is inside the sidebar viewport', MANY, { timeout: 200_000 }, async (s, log) => {
  await s.tabTo(groupRow('G05')); await s.press('Space');
  const failures: string[] = [];
  for (const key of ['ArrowDown', 'ArrowUp'] as const) {
    for (let i = 0; i < 17; i++) {
      await s.press(key, { ms: 450 });
      const out = await ghostOutside(s, ['sidebar']);
      if (out.length) failures.push(`${key}#${i} "${await s.live()}": ${out.join(';')}`);
    }
  }
  log('failures=' + (failures.length ? failures.slice(0, 6).join(' || ') : 'none'));
  await s.press('Escape');
  return failures.length === 0;
});
