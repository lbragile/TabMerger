/**
 * sameSizeResize.test.ts — `stopSameSizeResizes`, the guard that keeps Radix Select open in a
 * Firefox popup. A Firefox browser-action popup fires `resize` with an unchanged size after DOM
 * changes; those events must stop at the guard, while a resize that really changed the size
 * must still reach every other listener.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { stopSameSizeResizes } from '@/lib/sameSizeResize';

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

function setSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

let cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  setSize(originalWidth, originalHeight);
});

function listen() {
  const listener = vi.fn();
  window.addEventListener('resize', listener);
  cleanups.push(() => window.removeEventListener('resize', listener));
  return listener;
}

describe('stopSameSizeResizes', () => {
  it('stops a resize whose size did not change before ordinary window listeners see it', () => {
    setSize(800, 600);
    // Added BEFORE the guard: the guard still wins because it listens in the capture phase.
    const earlier = listen();
    cleanups.push(stopSameSizeResizes(window));
    const later = listen();

    window.dispatchEvent(new Event('resize'));

    expect(earlier).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });

  it('lets a resize through when the width or the height changed', () => {
    setSize(800, 600);
    cleanups.push(stopSameSizeResizes(window));
    const listener = listen();

    setSize(700, 600);
    window.dispatchEvent(new Event('resize'));
    expect(listener).toHaveBeenCalledTimes(1);

    setSize(700, 500);
    window.dispatchEvent(new Event('resize'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('compares against the last size it let through, not the size when it started', () => {
    setSize(800, 600);
    cleanups.push(stopSameSizeResizes(window));
    const listener = listen();

    setSize(640, 480);
    window.dispatchEvent(new Event('resize'));
    expect(listener).toHaveBeenCalledTimes(1);

    // Same as the size just let through: stopped.
    window.dispatchEvent(new Event('resize'));
    expect(listener).toHaveBeenCalledTimes(1);

    // Back to the starting size is a real change again: let through.
    setSize(800, 600);
    window.dispatchEvent(new Event('resize'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops nothing once the cleanup has run', () => {
    setSize(800, 600);
    const stop = stopSameSizeResizes(window);
    const listener = listen();

    stop();
    window.dispatchEvent(new Event('resize'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('only touches resize events', () => {
    setSize(800, 600);
    cleanups.push(stopSameSizeResizes(window));
    const onBlur = vi.fn();
    window.addEventListener('blur', onBlur);
    cleanups.push(() => window.removeEventListener('blur', onBlur));

    window.dispatchEvent(new Event('blur'));

    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
