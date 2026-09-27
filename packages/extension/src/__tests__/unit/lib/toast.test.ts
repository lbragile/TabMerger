/**
 * toast.test.ts — the `@/lib/toast` wrapper stamps every non-Infinity-duration call with
 * `--toast-duration`, which globals.css's countdown-bar pseudo-element reads via
 * `animation-duration: var(--toast-duration)`. Without this, the bar can't know how long
 * a given toast will actually live (sonner's own default, or a per-call override).
 */
import { describe, it, expect, vi } from 'vitest';

const sonnerToast = vi.fn(() => 'id') as unknown as ((...args: unknown[]) => string) & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
  loading: ReturnType<typeof vi.fn>;
};
sonnerToast.success = vi.fn(() => 'id');
sonnerToast.error = vi.fn(() => 'id');
sonnerToast.info = vi.fn(() => 'id');
sonnerToast.warning = vi.fn(() => 'id');
sonnerToast.dismiss = vi.fn();
sonnerToast.loading = vi.fn(() => 'id');

vi.mock('sonner', () => ({ toast: sonnerToast }));

describe('toast wrapper', () => {
  it('stamps --toast-duration with sonner\'s own default (4000ms) when no duration is given', async () => {
    const { toast, DEFAULT_TOAST_DURATION } = await import('@/lib/toast');
    toast.success('hi');
    expect(sonnerToast.success).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ style: expect.objectContaining({ '--toast-duration': `${DEFAULT_TOAST_DURATION}ms` }) })
    );
  });

  it('stamps --toast-duration with a per-call custom duration', async () => {
    const { toast } = await import('@/lib/toast');
    toast.error('boom', { duration: 8000 });
    expect(sonnerToast.error).toHaveBeenCalledWith(
      'boom',
      expect.objectContaining({ duration: 8000, style: expect.objectContaining({ '--toast-duration': '8000ms' }) })
    );
  });

  it('leaves Infinity-duration toasts untouched (no countdown bar)', async () => {
    const { toast } = await import('@/lib/toast');
    toast.info('sticky', { duration: Infinity });
    expect(sonnerToast.info).toHaveBeenCalledWith('sticky', { duration: Infinity });
  });

  it('preserves other options (e.g. action) alongside the injected style', async () => {
    const { toast } = await import('@/lib/toast');
    const action = { label: 'Upgrade', onClick: vi.fn() };
    toast.warning('careful', { action });
    expect(sonnerToast.warning).toHaveBeenCalledWith(
      'careful',
      expect.objectContaining({ action, style: expect.objectContaining({ '--toast-duration': expect.any(String) }) })
    );
  });

  it('the plain toast(...) call is also stamped', async () => {
    const { toast } = await import('@/lib/toast');
    toast('plain');
    expect(sonnerToast).toHaveBeenCalledWith(
      'plain',
      expect.objectContaining({ style: expect.objectContaining({ '--toast-duration': expect.any(String) }) })
    );
  });

  it('passes through non-duration methods untouched (loading, dismiss)', async () => {
    const { toast } = await import('@/lib/toast');
    toast.loading('working');
    toast.dismiss('id');
    expect(sonnerToast.loading).toHaveBeenCalledWith('working');
    expect(sonnerToast.dismiss).toHaveBeenCalledWith('id');
  });
});
