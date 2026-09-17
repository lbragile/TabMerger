/**
 * dndDebug.test.ts — the opt-in DnD instrumentation must be a true no-op unless
 * the `tm_dnd_debug` localStorage flag is set (no console spam for normal users),
 * and must emit both a `[tm-dnd]` console line and an on-screen corner chip when
 * it IS set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dndDebugLog, dndDebugEnabled, resetDndDebugCache } from '@/lib/dndDebug';

beforeEach(() => {
  localStorage.clear();
  resetDndDebugCache();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dndDebug — off by default', () => {
  it('dndDebugEnabled() is false with no flag', () => {
    expect(dndDebugEnabled()).toBe(false);
  });

  it('dndDebugLog does not call console.log or create a chip when disabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    dndDebugLog('onDragStart', { id: 'x' });
    expect(spy).not.toHaveBeenCalled();
    expect(document.getElementById('tm-dnd-debug-chip')).toBeNull();
  });
});

describe('dndDebug — enabled via localStorage flag', () => {
  beforeEach(() => {
    localStorage.setItem('tm_dnd_debug', '1');
    resetDndDebugCache();
  });

  it('dndDebugEnabled() is true', () => {
    expect(dndDebugEnabled()).toBe(true);
  });

  it('logs a [tm-dnd] prefixed line with the stage and detail', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    dndDebugLog('pointer-capture-set', { pointerId: 3 });
    expect(spy).toHaveBeenCalledWith('[tm-dnd]', 'pointer-capture-set', { pointerId: 3 });
  });

  it('mirrors the last stage into a fixed corner chip', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dndDebugLog('onDragEnd', { rawOverId: 'w1' });
    const chip = document.getElementById('tm-dnd-debug-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('onDragEnd');
    expect(chip?.style.position).toBe('fixed');
  });

  it('reuses the same chip element across calls', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dndDebugLog('a');
    dndDebugLog('b');
    expect(document.querySelectorAll('#tm-dnd-debug-chip')).toHaveLength(1);
    expect(document.getElementById('tm-dnd-debug-chip')?.textContent).toContain('b');
  });
});
