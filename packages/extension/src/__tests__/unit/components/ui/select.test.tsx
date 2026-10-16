/**
 * select.test.tsx — the shared Select primitive stays open through a same-size `resize`.
 *
 * Radix Select closes itself on every window `resize`. A Firefox browser-action popup fires
 * `resize` with an unchanged size after DOM changes, and opening the list is one, so every
 * Select in the popup (the Settings theme, search and stale-group menus, the backup interval,
 * URL rules and the shortcut picker) closed the moment it opened. SelectContent now stops
 * same-size resizes while the list is open. A resize that really changes the size still closes
 * the list as before, and keyboard use (open with Enter/Space/arrows, Escape closes and focus
 * goes back to the trigger) is unchanged.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

function setSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

beforeAll(() => {
  // Radix Select needs these in jsdom
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  setSize(originalWidth, originalHeight);
});

function Theme({
  contentRef,
  onValueChange = vi.fn(),
}: {
  contentRef?: React.Ref<HTMLDivElement>;
  onValueChange?: (value: string) => void;
}) {
  return (
    <Select defaultValue="light" onValueChange={onValueChange}>
      <SelectTrigger aria-label="Theme">
        <SelectValue />
      </SelectTrigger>
      <SelectContent ref={contentRef}>
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
        <SelectItem value="system">System</SelectItem>
      </SelectContent>
    </Select>
  );
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const resize = () => act(() => void window.dispatchEvent(new Event('resize')));

describe('SelectContent — same-size resize (Firefox popup)', () => {
  it('stays open when the window fires resize without changing size', async () => {
    setSize(800, 600);
    const u = user();
    render(<Theme />);
    await u.click(screen.getByRole('combobox', { name: 'Theme' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    // What the Firefox popup does after the list mounts.
    resize();
    resize();

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // The open list hides the rest of the page from assistive tech, so the trigger is aria-hidden.
    expect(screen.getByRole('combobox', { name: 'Theme', hidden: true })).toHaveAttribute('aria-expanded', 'true');
  });

  it('an option can still be picked after a same-size resize', async () => {
    setSize(800, 600);
    const u = user();
    const onValueChange = vi.fn();
    render(<Theme onValueChange={onValueChange} />);
    await u.click(screen.getByRole('combobox', { name: 'Theme' }));
    await screen.findByRole('listbox');
    resize();

    await u.click(screen.getByRole('option', { name: 'Dark' }));

    expect(onValueChange).toHaveBeenCalledWith('dark');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('still closes when the window size really changes (Radix default kept)', async () => {
    setSize(800, 600);
    const u = user();
    render(<Theme />);
    await u.click(screen.getByRole('combobox', { name: 'Theme' }));
    await screen.findByRole('listbox');

    setSize(1024, 768);
    resize();

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('removes its guard once the list closes, so other resize listeners hear same-size resizes again', async () => {
    setSize(800, 600);
    const u = user();
    render(<Theme />);
    await u.click(screen.getByRole('combobox', { name: 'Theme' }));
    await screen.findByRole('listbox');
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());

    const listener = vi.fn();
    window.addEventListener('resize', listener);
    resize();
    window.removeEventListener('resize', listener);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('SelectContent — ref forwarding', () => {
  it('gives an object ref the list element while open and null after it closes', async () => {
    const u = user();
    const ref = React.createRef<HTMLDivElement>();
    render(<Theme contentRef={ref} />);
    expect(ref.current).toBeNull();

    await u.click(screen.getByRole('combobox', { name: 'Theme' }));
    const listbox = await screen.findByRole('listbox');
    expect(ref.current).toBe(listbox);

    await u.keyboard('{Escape}');
    await waitFor(() => expect(ref.current).toBeNull());
  });

  it('calls a function ref with the list element and then with null', async () => {
    const u = user();
    const ref = vi.fn();
    render(<Theme contentRef={ref} />);

    await u.click(screen.getByRole('combobox', { name: 'Theme' }));
    const listbox = await screen.findByRole('listbox');
    expect(ref).toHaveBeenCalledWith(listbox);

    await u.keyboard('{Escape}');
    await waitFor(() => expect(ref).toHaveBeenLastCalledWith(null));
  });
});

describe('SelectContent — keyboard', () => {
  it.each(['{Enter}', ' ', '{ArrowDown}'])('opens with %s and survives a same-size resize', async (key) => {
    setSize(800, 600);
    const u = user();
    render(<Theme />);
    screen.getByRole('combobox', { name: 'Theme' }).focus();

    await u.keyboard(key);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    resize();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Escape closes the list and focus goes back to the trigger', async () => {
    const u = user();
    render(<Theme />);
    const trigger = screen.getByRole('combobox', { name: 'Theme' });
    trigger.focus();
    await u.keyboard('{Enter}');
    await screen.findByRole('listbox');

    await u.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
