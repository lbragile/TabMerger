import { useState, useEffect, useRef, useCallback, forwardRef, type ButtonHTMLAttributes } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { PRESET_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';
import { rgbaToHex, hexToRgba } from '@/lib/color';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /**
   * Fired on every in-progress Custom-colour change (drag or valid hex typed) with the
   * live rgba string, rAF-throttled so a drag doesn't fire dozens of times per frame.
   * Fired with `null` when the preview should be cleared (Apply committed, Cancel,
   * Escape, outside-click close, or unmount while still open). NOT the persisting
   * callback — callers should use this purely to render a live preview, never to write
   * to storage.
   */
  onPreview?: (color: string | null) => void;
}

/**
 * Rainbow conic-gradient always shown on the Custom colour control — it is a GENERIC
 * "open the custom picker" affordance, never the group's actual current or last-picked
 * custom colour (only the border/ring "selected" state reflects whether a custom colour
 * is active).
 */
const CUSTOM_SWATCH_GRADIENT =
  'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';

/** Single source of truth for the custom-colour control's visible label (also its accessible name). */
const CUSTOM_COLOR_LABEL = 'Custom colour';

/**
 * Faint, real edge border so every swatch reads against the surface behind it in BOTH
 * themes (a dark swatch on the dark theme, a light one on light) — present on every swatch
 * regardless of selection. A real `border` (not an inset ring drawn over the colour) so it
 * sits ON the swatch's edge; Tailwind's border-box sizing means it never shifts the 6-column
 * grid's layout.
 */
const SWATCH_HAIRLINE = 'border border-foreground/15';

/** Outer 1px "this is the active colour" ring, layered OUTSIDE the hairline border via `ring-offset`. */
const SWATCH_SELECTED = 'ring-1 ring-foreground ring-offset-1';

/**
 * Keyboard-focus indicator: a 1px primary-coloured OUTLINE further out than the selected
 * ring. An outline rather than a second ring because both would be `ring-*` classes, and
 * tailwind-merge keeps only one ring colour — a selected + focused swatch would lose its
 * selected ring.
 */
const SWATCH_KEYBOARD_FOCUS = 'outline outline-offset-3 outline-primary';

/**
 * Chromium's native `:focus-visible` heuristic shows a ring for ANY programmatic `.focus()`
 * call, including the "focus whichever swatch matches the current colour" autofocus-fix
 * below — even when the popover was opened with a plain mouse click. Relying on
 * `focus-visible:` alone therefore reintroduces the exact bug being fixed here (a ring on
 * open regardless of how it was opened). Instead we track the true input modality ourselves
 * (module-scope: one pair of capture-phase listeners for every ColorPicker instance) and
 * apply the ring purely from that, never from the native pseudo-class.
 */
let lastInputWasKeyboard = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => { lastInputWasKeyboard = false; }, true);
  document.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
}

/** Shows {@link SWATCH_KEYBOARD_FOCUS} only when the element was focused via keyboard modality. */
function useKeyboardFocusRing() {
  const [visible, setVisible] = useState(false);
  return {
    visible,
    onFocus: () => setVisible(lastInputWasKeyboard),
    onBlur: () => setVisible(false),
  };
}

interface SwatchButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected: boolean;
  /** Skip the hairline and selected ring on the button itself (the Custom colour row draws them on its inner swatch). */
  bare?: boolean;
}

/**
 * Shared button chrome for every focusable swatch-like control (preset swatches, the Custom
 * colour trigger): hairline border, selected ring, and the synthetic keyboard-focus ring —
 * one place so all three stay visually consistent (DRY).
 */
const SwatchButton = forwardRef<HTMLButtonElement, SwatchButtonProps>(
  ({ selected, bare = false, className, onFocus, onBlur, ...props }, ref) => {
    const kb = useKeyboardFocusRing();
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          !bare && SWATCH_HAIRLINE,
          !bare && selected && SWATCH_SELECTED,
          kb.visible ? SWATCH_KEYBOARD_FOCUS : 'focus:outline-none',
          className
        )}
        onFocus={(e) => {
          kb.onFocus();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          kb.onBlur();
          onBlur?.(e);
        }}
        {...props}
      />
    );
  }
);
SwatchButton.displayName = 'SwatchButton';

export function ColorPicker({ value, onChange, onPreview }: ColorPickerProps) {
  const isPreset = PRESET_COLORS.includes(value);
  const [customOpen, setCustomOpen] = useState(false);
  // Single source of truth for the in-progress edit, in the project's rgba() format —
  // both the saturation/hue picker and the hex field read/write this (always opaque).
  const [draftRgba, setDraftRgba] = useState(value);
  // The hex string we last FED to react-colorful/HexColorInput as their `color` prop, kept
  // and fed back verbatim on every render rather than re-derived from `draftRgba` on every
  // render — re-deriving via rgbaToHex() hands them a brand-new (if value-equal) string each
  // time, and that plus their own onChange-on-external-change effect is exactly the shape of
  // loop the "Maximum update depth exceeded" bug came from. Keeping their own last-known
  // string stable means their internal `equal()` check short-circuits instead of re-diffing.
  const draftHexRef = useRef(rgbaToHex(value));

  // Deliberately NOT a useEffect keyed on `value` — seeding on every `value` change while
  // open is exactly how a preview-fed-back-as-value loop happens. Seed once, at the moment
  // the popup opens; never re-seed while it stays open.
  const openCustomPicker = () => {
    draftHexRef.current = rgbaToHex(value);
    setDraftRgba(value);
    setCustomOpen(true);
  };

  // Latest-ref for onPreview so `schedulePreview` never needs onPreview in its own deps —
  // an inline arrow prop (as GroupItem/AddGroup pass) gets a new identity every parent
  // render, which would otherwise force a new rAF-scheduling closure every render too.
  const onPreviewRef = useRef(onPreview);
  useEffect(() => {
    onPreviewRef.current = onPreview;
  });

  // rAF-throttle the external preview callback so a drag across the saturation area
  // doesn't fire onPreview (and a re-render of every consumer) on every pointermove.
  const rafRef = useRef<number | null>(null);
  const pendingPreviewRef = useRef<string | null>(null);
  const schedulePreview = useCallback((color: string | null) => {
    if (!onPreviewRef.current) return;
    pendingPreviewRef.current = color;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onPreviewRef.current?.(pendingPreviewRef.current);
    });
  }, []);

  // Clear any live preview when the popup unmounts while still open (e.g. the PARENT
  // popover/dialog closes out from under it) so no stale preview lingers in the store.
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      onPreviewRef.current?.(null);
    },
    []
  );

  // Fires from react-colorful/HexColorInput with a freshly-emitted hex string — recorded
  // verbatim as the new "last known" hex (see draftHexRef above) instead of re-derived, and
  // skipped entirely if it's a no-op (guards against any redundant re-emit causing extra
  // renders/rAF churn).
  const handleHexChange = (hex: string) => {
    if (hex === draftHexRef.current) return;
    draftHexRef.current = hex;
    const rgba = hexToRgba(hex);
    setDraftRgba(rgba);
    schedulePreview(rgba);
  };

  const handleApply = () => {
    onChange(draftRgba);
    onPreviewRef.current?.(null);
    setCustomOpen(false);
  };

  const handleCancel = () => {
    onPreviewRef.current?.(null);
    setCustomOpen(false);
  };

  // Radix's default popover autofocus lands on the first focusable descendant (the FIRST
  // preset swatch) regardless of which colour is actually selected. Correct that on mount —
  // this component only exists while the parent popover is open, so mount-time is exactly
  // open-time — by focusing whichever control represents the CURRENT colour instead. Whether
  // that shows a ring is handled by useKeyboardFocusRing()/lastInputWasKeyboard above, not
  // by this effect.
  const selectedSwatchRef = useRef<HTMLButtonElement | null>(null);
  const customTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const target = isPreset ? selectedSwatchRef.current : customTriggerRef.current;
    target?.focus({ preventScroll: true });
    // Run once, on mount, matching the parent popover's own open — not on every `value`/
    // `isPreset` change (which would fight the user's own focus while it stays open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {/* Preset swatches */}
      <div className="grid grid-cols-6 gap-1.5 p-1">
        {PRESET_COLORS.map((color) => (
          <SwatchButton
            key={color}
            ref={value === color ? selectedSwatchRef : undefined}
            selected={value === color}
            onClick={() => onChange(color)}
            className={cn(
              'h-6 w-6 rounded-full transition-transform hover:scale-110',
              value === color && 'scale-110'
            )}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      {/* Custom colour — its own labelled row, separate from the preset grid */}
      <div className="px-1 pb-1 pt-0.5">
        <Popover
          open={customOpen}
          onOpenChange={(open) => {
            if (open) {
              openCustomPicker();
              return;
            }
            setCustomOpen(false);
            // Covers every non-Apply close path: Escape (also handled below, harmless to
            // repeat), outside click, and Radix's own dismissal — Apply already cleared it.
            onPreviewRef.current?.(null);
          }}
        >
          <PopoverTrigger asChild>
            <SwatchButton
              ref={customTriggerRef}
              bare
              selected={!isPreset}
              onClick={(e) => e.stopPropagation()}
              className="flex w-full items-center gap-2 rounded-none px-1.5 py-1 text-[11px] transition-colors hover:bg-accent"
            >
              {/* Always the generic rainbow affordance — never the current/last custom colour.
                  Selection shows as the same ring presets use, on this swatch, not the whole row. */}
              <span
                data-testid="custom-colour-swatch"
                className={cn('h-4 w-4 shrink-0 rounded-full', SWATCH_HAIRLINE, !isPreset && SWATCH_SELECTED)}
                style={{ background: CUSTOM_SWATCH_GRADIENT }}
                aria-hidden="true"
              />
              <span>{CUSTOM_COLOR_LABEL}</span>
            </SwatchButton>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto space-y-2 p-2"
            side="bottom"
            align="start"
            sideOffset={4}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                handleCancel();
              }
            }}
          >
            <p className="text-[11px] font-medium text-foreground">{CUSTOM_COLOR_LABEL}</p>
            <HexColorPicker color={draftHexRef.current} onChange={handleHexChange} />

            <div className="flex items-center gap-2">
              <span
                className={cn('h-4 w-4 shrink-0 rounded-full', SWATCH_HAIRLINE)}
                style={{ backgroundColor: draftRgba }}
              />
              <HexColorInput
                prefixed
                color={draftHexRef.current}
                onChange={handleHexChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApply();
                }}
                spellCheck={false}
                className="h-6 flex-1 min-w-0 border border-border bg-transparent px-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                title="Enter hex colour (#rrggbb)"
                placeholder="#rrggbb"
              />
            </div>

            <div className="flex justify-end gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
