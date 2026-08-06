import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression check for a CSS-cascade bug: `[role="button"]:not([aria-disabled="true"])` in
 * globals.css has specificity (0,2,0), which beats Tailwind's single-class `.cursor-grab`
 * utility (0,1,0). @dnd-kit's `useSortable()` spreads `role="button"` AND
 * `aria-roledescription="sortable"` onto every drag handle (Tab.tsx/GroupItem.tsx/Window.tsx),
 * so without the `:not([aria-roledescription="sortable"])` exclusion, the global rule silently
 * forces `cursor: pointer` on drag handles despite `cursor-grab` being present in the JSX.
 *
 * IMPORTANT — this is a static/string check, not a cascade check: jsdom does not resolve real
 * CSS specificity/cascade (Tailwind's `@layer`, `:where()`, arbitrary variants aren't evaluated
 * by getComputedStyle in jsdom the way a real browser engine does), so a jsdom-based
 * getComputedStyle assertion here would NOT actually catch this class of bug — it was only
 * caught by walking document.styleSheets in a real browser. The authoritative regression check
 * for the live cascade behavior is the Playwright test in
 * e2e/tests/windows.spec.ts ("tab drag handle keeps grab cursor despite global
 * [role="button"] cursor rule"), which asserts real getComputedStyle(el).cursor === 'grab'.
 * This test only guards against someone editing/removing the exclusion selector in isolation
 * without realizing why it's there.
 */
describe('globals.css — [role="button"] cursor rule / @dnd-kit coupling', () => {
  const css = readFileSync(path.resolve(__dirname, '../../../styles/globals.css'), 'utf-8');

  it('excludes aria-roledescription="sortable" from the global [role="button"] cursor:pointer rule', () => {
    const match = css.match(/\[role="button"\]:not\(\[aria-disabled="true"\]\)([^,]*)/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain(':not([aria-roledescription="sortable"])');
  });

  it.each([
    ['Tab.tsx', '../../../components/Windows/Tab.tsx'],
    ['GroupItem.tsx', '../../../components/SidePanel/GroupItem.tsx'],
    ['Window.tsx', '../../../components/Windows/Window.tsx']
  ])('%s drag handle keeps the cursor-grab class alongside spread useSortable() attributes', (_name, relPath) => {
    const src = readFileSync(path.resolve(__dirname, relPath), 'utf-8');
    expect(src).toMatch(/useSortable\(/);
    expect(src).toMatch(/cursor-grab/);
    // the handle must spread `attributes` (which carries role="button" + aria-roledescription
    // from dnd-kit) — if this coupling is ever removed, the exclusion selector above becomes
    // dead code and the next unrelated global-CSS change could silently reintroduce the bug.
    expect(src).toMatch(/\.\.\.attributes/);
  });
});
