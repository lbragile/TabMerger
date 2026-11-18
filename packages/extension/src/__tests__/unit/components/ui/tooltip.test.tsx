import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';

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

describe('TooltipContent rendering', () => {
  it('renders in a portal under <body>: outside a dimmed row and the sidebar ScrollArea, so neither their opacity nor the scrollbar covers it', async () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ScrollArea className="h-20" data-testid="scroll">
          <div className="opacity-60" data-testid="dimmed-row">
            <Tooltip open>
              <TooltipTrigger asChild>
                <button>Locked group</button>
              </TooltipTrigger>
              <TooltipContent>Upgrade to Pro to access this group</TooltipContent>
            </Tooltip>
          </div>
        </ScrollArea>
      </TooltipProvider>
    );
    const tip = await screen.findByRole('tooltip');
    // The visible bubble (Radix keeps a hidden copy of the text for the role="tooltip" node)
    const bubble = screen.getAllByText('Upgrade to Pro to access this group').find((el) => el.closest('[data-radix-popper-content-wrapper]'))!;
    const popper = bubble.closest<HTMLElement>('[data-radix-popper-content-wrapper]')!;
    expect(tip).toBeTruthy();
    expect(container.contains(popper)).toBe(false);
    expect(screen.getByTestId('dimmed-row').contains(popper)).toBe(false);
    expect(popper.parentElement).toBe(document.body);
    // Painted after the app's root (later in <body>), at z-index 50
    expect(container.compareDocumentPosition(popper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bubble).toHaveClass('z-50', 'rounded-none', 'bg-tooltip', 'text-tooltip-foreground');
  });
});
