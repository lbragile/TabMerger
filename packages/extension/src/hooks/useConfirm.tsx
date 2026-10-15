import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmOptions } from '@/components/Modal/ConfirmDialog';

export interface ConfirmRequest extends ConfirmOptions {
  /**
   * Where focus goes when the dialog closes. Defaults to the element focused when the question
   * was asked (the button that was pressed). Pass it when the question is asked after something
   * that moved focus away, such as the browser's file picker.
   */
  returnFocusTo?: HTMLElement | null;
}

/**
 * An in-app replacement for the browser's `confirm()`.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * if (!(await confirm({ title, description, confirmLabel: 'Delete backup', destructive: true }))) return;
 * ...
 * return <>{...}{confirmDialog}</>;
 * ```
 *
 * `confirm` resolves `true` only for the action button; Cancel, Escape, the close button, a second
 * question asked while one is open, and the component unmounting all resolve `false`. Each
 * question is answered once, so a double click on the action button cannot run the action twice.
 * `confirmDialog` must be rendered by the component that calls `confirm`.
 */
export function useConfirm(): { confirm: (request: ConfirmRequest) => Promise<boolean>; confirmDialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(confirmed);
  }, []);

  // The asking component went away (its modal closed): nothing was confirmed.
  useEffect(() => () => settle(false), [settle]);

  const confirm = useCallback(
    ({ returnFocusTo, ...request }: ConfirmRequest) => {
      settle(false);
      const active = document.activeElement;
      returnFocusRef.current = returnFocusTo ?? (active instanceof HTMLElement && active !== document.body ? active : null);
      setOptions(request);
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
      });
    },
    [settle]
  );

  const handleResult = useCallback(
    (confirmed: boolean) => {
      setOptions(null);
      settle(confirmed);
    },
    [settle]
  );

  const handleClosed = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  return { confirm, confirmDialog: <ConfirmDialog options={options} onResult={handleResult} onClosed={handleClosed} /> };
}
