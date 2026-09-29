import { toast as sonnerToast, type ExternalToast } from 'sonner';

/**
 * Must match sonner's own internal default (`TOAST_LIFETIME` in sonner's source) — sonner
 * falls back to this value whenever a call doesn't pass `duration`, so the countdown bar
 * needs to know it too in order to size its animation correctly for "default" toasts.
 */
export const DEFAULT_TOAST_DURATION = 4000;

/**
 * Every toast (default-duration or custom) needs `--toast-duration` set on itself so the
 * bottom-edge countdown bar (`[data-sonner-toast]::after` in globals.css) can animate over
 * exactly the toast's real lifetime. `Infinity`-duration toasts (and sonner's own `loading`
 * type, which never auto-dismisses) are left alone — no bar is drawn for those.
 */
function withDurationVar(opts?: ExternalToast): ExternalToast | undefined {
  const duration = opts?.duration ?? DEFAULT_TOAST_DURATION;
  if (duration === Infinity) return opts;
  return {
    ...opts,
    style: {
      ...(opts?.style as Record<string, string> | undefined),
      '--toast-duration': `${duration}ms`
    } as React.CSSProperties
  };
}

/**
 * Thin wrapper around sonner's `toast` that stamps every non-`loading` call with
 * `--toast-duration` (see `withDurationVar`). Import this instead of sonner's `toast`
 * anywhere in the extension so the countdown bar stays in sync automatically —
 * `toast.loading`/`toast.promise`/`toast.custom`/`toast.dismiss` etc. pass through untouched.
 *
 * Typed as `typeof sonnerToast` (rather than re-deriving sonner's generic call signature,
 * which involves a `titleT` type param this wrapper doesn't need) since every method here
 * has the same public shape sonner itself exposes.
 */
export const toast = Object.assign(
  (message: React.ReactNode, opts?: ExternalToast) => sonnerToast(message, withDurationVar(opts)),
  {
    ...sonnerToast,
    success: (message: React.ReactNode, opts?: ExternalToast) => sonnerToast.success(message, withDurationVar(opts)),
    error: (message: React.ReactNode, opts?: ExternalToast) => sonnerToast.error(message, withDurationVar(opts)),
    info: (message: React.ReactNode, opts?: ExternalToast) => sonnerToast.info(message, withDurationVar(opts)),
    warning: (message: React.ReactNode, opts?: ExternalToast) => sonnerToast.warning(message, withDurationVar(opts))
  }
) as typeof sonnerToast;
