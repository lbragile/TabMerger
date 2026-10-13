import { useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** What one confirmation asks. Every string is rendered as text. */
export interface ConfirmOptions {
  title: string;
  /** The full explanation: what happens, what is lost, whether it can be undone. */
  description: string;
  /** Names the action ("Delete backup"), never a bare "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions get the red button and start with focus on Cancel. */
  destructive?: boolean;
}

interface ConfirmDialogProps {
  /** `null` while nothing is being asked. */
  options: ConfirmOptions | null;
  /** Called exactly once per question: `true` for the action button, `false` for Cancel, Escape or the close button. */
  onResult: (confirmed: boolean) => void;
  /** Called once the dialog has closed and focus may go back to whatever opened it. */
  onClosed?: () => void;
}

/**
 * The extension's own confirmation box (replaces the browser's `confirm()`, which opens a
 * separate native window from a popup). Use it through `useConfirm`.
 *
 * It is its own dialog, not an entry in `uiStore.modal`: that store has one slot, so opening a
 * confirmation through it from inside Settings would unmount Settings. Rendered inside the
 * component that asks, it stacks on top: Escape and Cancel close only this box.
 *
 * `role="alertdialog"`: it interrupts and needs an answer, so a click outside does not dismiss it.
 */
export function ConfirmDialog({ options, onResult, onClosed }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The texts stay on screen while the dialog animates out, after `options` became null.
  const shownRef = useRef<ConfirmOptions | null>(null);
  if (options) shownRef.current = options;
  const shown = options ?? shownRef.current;

  return (
    <Dialog open={options !== null} onOpenChange={(open) => !open && onResult(false)}>
      {shown && (
        <DialogContent
          role="alertdialog"
          className="max-w-sm min-w-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (shown.destructive ? cancelRef : confirmRef).current?.focus();
          }}
          onCloseAutoFocus={() => onClosed?.()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="min-w-0">
            <DialogTitle className={cn('break-words pr-6', shown.destructive && 'text-destructive')}>{shown.title}</DialogTitle>
            <DialogDescription className="break-words">{shown.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:space-x-0">
            <Button ref={cancelRef} variant="outline" onClick={() => onResult(false)}>
              {shown.cancelLabel ?? 'Cancel'}
            </Button>
            <Button ref={confirmRef} variant={shown.destructive ? 'destructive' : 'default'} onClick={() => onResult(true)}>
              {shown.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
