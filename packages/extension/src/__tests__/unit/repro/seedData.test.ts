import { describe, it, expect } from 'vitest';
import {
  buildSeedGroups,
  countSeedTabs,
  resolveSeedConfig,
  SEED_DEFAULTS,
  SEED_LIMITS,
  type SeedConfig,
} from '../../../../e2e/repro/seedData';

/**
 * Unit coverage for the pure seed-data builder behind `pnpm seed:dev`
 * (`e2e/repro/seedData.ts`). The Playwright runner + persistent-Chrome plumbing
 * in `seedDev.ts` is a dev-only manual tool and is not unit-tested (same
 * treatment as the sibling `*.repro.ts` scripts).
 */

const stripSavedAt = (groups: unknown): unknown =>
  JSON.parse(JSON.stringify(groups), (k, v) => (k === 'savedAt' ? 0 : v));

describe('resolveSeedConfig', () => {
  it('returns the documented defaults for an empty env', () => {
    expect(resolveSeedConfig({})).toEqual(SEED_DEFAULTS);
  });

  it('parses each SEED_* var', () => {
    const cfg = resolveSeedConfig({
      SEED_GROUPS: '6',
      SEED_WINDOWS: '3',
      SEED_TABS: '8',
      SEED_VARY: '0',
    });
    expect(cfg).toEqual<SeedConfig>({
      groups: 6,
      windowsPerGroup: 3,
      tabsPerWindow: 8,
      vary: false,
    });
  });

  it('clamps out-of-range values to the hard limits', () => {
    const low = resolveSeedConfig({ SEED_GROUPS: '0', SEED_WINDOWS: '0', SEED_TABS: '0' });
    expect(low.groups).toBe(SEED_LIMITS.groups[0]);
    expect(low.windowsPerGroup).toBe(SEED_LIMITS.windowsPerGroup[0]);
    expect(low.tabsPerWindow).toBe(SEED_LIMITS.tabsPerWindow[0]);

    const high = resolveSeedConfig({ SEED_GROUPS: '999', SEED_WINDOWS: '999', SEED_TABS: '999' });
    expect(high.groups).toBe(SEED_LIMITS.groups[1]);
    expect(high.windowsPerGroup).toBe(SEED_LIMITS.windowsPerGroup[1]);
    expect(high.tabsPerWindow).toBe(SEED_LIMITS.tabsPerWindow[1]);
  });

  it('falls back to the default when a var is not a finite number', () => {
    const cfg = resolveSeedConfig({ SEED_GROUPS: 'abc', SEED_TABS: '' });
    expect(cfg.groups).toBe(SEED_DEFAULTS.groups);
    expect(cfg.tabsPerWindow).toBe(SEED_DEFAULTS.tabsPerWindow);
  });

  it('treats "false"/"0" as vary-off and anything else as vary-on', () => {
    expect(resolveSeedConfig({ SEED_VARY: 'false' }).vary).toBe(false);
    expect(resolveSeedConfig({ SEED_VARY: '0' }).vary).toBe(false);
    expect(resolveSeedConfig({ SEED_VARY: '1' }).vary).toBe(true);
    expect(resolveSeedConfig({ SEED_VARY: 'yes' }).vary).toBe(true);
  });
});

describe('buildSeedGroups — defaults', () => {
  const groups = buildSeedGroups();

  it('builds ~4 saved groups', () => {
    expect(groups).toHaveLength(SEED_DEFAULTS.groups);
  });

  it('never emits the permanent "Now Open" group', () => {
    for (const g of groups) {
      expect('permanent' in g).toBe(false);
      expect(g.name).not.toBe('Now Open');
    }
  });

  it('gives every group a stable readable id, a name and an rgba colour', () => {
    groups.forEach((g, i) => {
      expect(g.id).toBe(`seed-g${i + 1}`);
      expect(g.name.length).toBeGreaterThan(0);
      expect(g.color).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
    });
  });

  it('produces realistic tabs — id:0 sentinel, parseable https url, favicon, savedAt', () => {
    const tabs = groups.flatMap((g) => g.windows.flatMap((w) => w.tabs));
    expect(tabs.length).toBeGreaterThan(0);
    for (const t of tabs) {
      expect(t.id).toBe(0); // saved-tab invariant
      expect(t.title.length).toBeGreaterThan(0);
      expect(() => new URL(t.url)).not.toThrow();
      expect(t.url.startsWith('https://')).toBe(true);
      expect(t.favIconUrl).toMatch(/^https:\/\//);
      expect(typeof t.savedAt).toBe('number');
    }
  });

  it('varies window and tab counts across groups (not all identical)', () => {
    const winCounts = new Set(groups.map((g) => g.windows.length));
    const tabCounts = new Set(groups.flatMap((g) => g.windows.map((w) => w.tabs.length)));
    expect(winCounts.size).toBeGreaterThan(1);
    expect(tabCounts.size).toBeGreaterThan(1);
  });

  it('countSeedTabs matches a manual sum', () => {
    const manual = groups.reduce(
      (a, g) => a + g.windows.reduce((b, w) => b + w.tabs.length, 0),
      0
    );
    expect(countSeedTabs(groups)).toBe(manual);
  });
});

describe('buildSeedGroups — config is honoured', () => {
  it('with vary:false every group/window has exactly the configured counts', () => {
    const cfg = { groups: 5, windowsPerGroup: 3, tabsPerWindow: 7, vary: false };
    const groups = buildSeedGroups(cfg);
    expect(groups).toHaveLength(5);
    for (const g of groups) {
      expect(g.windows).toHaveLength(3);
      for (const w of g.windows) expect(w.tabs).toHaveLength(7);
    }
    expect(countSeedTabs(groups)).toBe(5 * 3 * 7);
  });

  it('with vary:true counts stay within [1..windows] and [min(3,tabs)..tabs]', () => {
    const cfg = { groups: 8, windowsPerGroup: 3, tabsPerWindow: 8, vary: true };
    const groups = buildSeedGroups(cfg);
    expect(groups).toHaveLength(8);
    for (const g of groups) {
      expect(g.windows.length).toBeGreaterThanOrEqual(1);
      expect(g.windows.length).toBeLessThanOrEqual(cfg.windowsPerGroup);
      for (const w of g.windows) {
        expect(w.tabs.length).toBeGreaterThanOrEqual(Math.min(3, cfg.tabsPerWindow));
        expect(w.tabs.length).toBeLessThanOrEqual(cfg.tabsPerWindow);
      }
    }
  });

  it('honours a small config (1 group / 1 window / 1 tab) without underflow', () => {
    const groups = buildSeedGroups({ groups: 1, windowsPerGroup: 1, tabsPerWindow: 1, vary: true });
    expect(groups).toHaveLength(1);
    expect(groups[0].windows).toHaveLength(1);
    expect(groups[0].windows[0].tabs).toHaveLength(1);
  });

  it('assigns unique window ids within the built seed', () => {
    const groups = buildSeedGroups({ groups: 6, windowsPerGroup: 4, tabsPerWindow: 4, vary: true });
    const ids = groups.flatMap((g) => g.windows.map((w) => w.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildSeedGroups — determinism', () => {
  it('same config in → identical structure out (modulo savedAt)', () => {
    const cfg = { groups: 4, windowsPerGroup: 2, tabsPerWindow: 6, vary: true };
    expect(stripSavedAt(buildSeedGroups(cfg))).toEqual(stripSavedAt(buildSeedGroups(cfg)));
  });

  it('cycles distinct group names and colours', () => {
    const groups = buildSeedGroups({ groups: 4, windowsPerGroup: 1, tabsPerWindow: 3, vary: false });
    expect(new Set(groups.map((g) => g.name)).size).toBe(4);
    expect(new Set(groups.map((g) => g.color)).size).toBe(4);
  });
});
