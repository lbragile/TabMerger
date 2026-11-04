import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

function setup(onFocus?: () => void) {
  render(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button onFocus={onFocus}>Trigger</button>
        </TooltipTrigger>
        <TooltipContent>Tip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
  return screen.getByRole('button', { name: 'Trigger' });
}

function mockFocusVisible(value: boolean | 'throw') {
  const original = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel: string) {
    if (sel === ':focus-visible') {
      if (value === 'throw') throw new SyntaxError('unsupported selector');
      return value;
    }
    return original.call(this, sel);
  });
}

describe('TooltipTrigger focus handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not open on focus that is not focus-visible', () => {
    mockFocusVisible(false);
    const button = setup();
    act(() => button.focus());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on keyboard (focus-visible) focus', async () => {
    mockFocusVisible(true);
    const button = setup();
    act(() => button.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Tip text');
  });

  it('treats an unsupported :focus-visible selector as focus-visible', async () => {
    mockFocusVisible('throw');
    const button = setup();
    act(() => button.focus());
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });

  it("still runs the caller's onFocus", () => {
    mockFocusVisible(false);
    const onFocus = vi.fn();
    const button = setup(onFocus);
    fireEvent.focus(button);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});
