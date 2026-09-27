/**
 * dialog.test.tsx — DialogContent's outside-interaction guard for the sonner toaster.
 *
 * The toaster ([data-sonner-toaster]) portals to <body> as a sibling of every dialog, not a
 * descendant. Once toasts became clickable (globals.css's `pointer-events: auto !important`
 * fix for the "toast doesn't dismiss" bug), Radix's DismissableLayer started seeing a click
 * on a toast as an outside-interaction on whatever dialog happened to be open, and would
 * close it — discarding an in-progress form (Auth sign-in, Settings' unsaved draft, etc.).
 * DialogContent now swallows onPointerDownOutside/onInteractOutside specifically when the
 * event target is inside [data-sonner-toaster], and only then — every other outside
 * interaction must still behave exactly as Radix's default.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

function renderDialog(onOpenChange: (open: boolean) => void) {
  render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Test dialog</DialogTitle>
        <button>Inside</button>
      </DialogContent>
    </Dialog>
  );
}

afterEach(() => {
  document.querySelectorAll('[data-test-outside]').forEach((el) => el.remove());
});

describe('DialogContent — sonner toaster outside-interaction guard', () => {
  it('does not report a dismiss when the outside interaction originates on [data-sonner-toaster]', async () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    // Simulates sonner's real portal shape: [data-sonner-toaster] as the ancestor, the
    // actual click landing on a nested button (a toast's close/action button) — closest()
    // in the guard must walk up to find the toaster attribute, not just check the direct target.
    // jsdom doesn't load the app's real stylesheet, so globals.css's
    // `[data-sonner-toaster] { pointer-events: auto !important; }` isn't in effect here —
    // set it inline to reproduce what that rule does in the real popup (Radix sets
    // pointer-events:none on <body> while this dialog is open).
    const toaster = document.createElement('div');
    toaster.setAttribute('data-sonner-toaster', '');
    toaster.setAttribute('data-test-outside', '');
    toaster.style.pointerEvents = 'auto';
    const toastCloseBtn = document.createElement('button');
    toastCloseBtn.textContent = 'Close toast';
    toaster.appendChild(toastCloseBtn);
    document.body.appendChild(toaster);

    await userEvent.click(toastCloseBtn);

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText('Test dialog')).toBeInTheDocument();
  });

  it('still reports a dismiss for a genuine outside interaction unrelated to the toaster', async () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    const outsideBtn = document.createElement('button');
    outsideBtn.textContent = 'Somewhere else on the page';
    outsideBtn.setAttribute('data-test-outside', '');
    // Same reasoning as the toaster test's inline override: in the real popup this element
    // would be inert too (Radix's body pointer-events:none), so it'd never generate a real
    // click either way. What matters here is proving the guard's specificity — that it
    // doesn't swallow outside interactions unrelated to the toaster — not reproducing that
    // separate, unrelated inertness.
    outsideBtn.style.pointerEvents = 'auto';
    document.body.appendChild(outsideBtn);

    await userEvent.click(outsideBtn);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a click on content genuinely inside the dialog never reports a dismiss', async () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    await userEvent.click(screen.getByRole('button', { name: 'Inside' }));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
