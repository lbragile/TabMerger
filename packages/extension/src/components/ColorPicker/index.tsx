import { useState, useEffect, useRef, useCallback, forwardRef, type ButtonHTMLAttributes } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { PRESET_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';
import { rgbaToHex, hexToRgba } from '@/lib/color';
import { Button } from '@/components/ui/button';

interface ColorPickerProps {
  value: string;
  /** Commits the chosen colour (Apply, or Enter in the hex field). */
  onChange: (color: string) => void;
  /** Cancel pressed: the host should close whatever contains the picker. Nothing is committed. */
  onCancel?: () => void;
  /**
   * Fired on every in-progress change (swatch picked, drag, or valid hex typed) with the
   * live rgba string, rAF-throttled so a drag doesn't fire dozens of times per frame.
   * Fired with `null` when the preview should be cleared (Apply, Cancel, or unmount — which
   * covers Escape and outside-click closes of the host popover). NOT the persisting
   * callback — callers should use this purely to render a live preview, never to write
   * to storage.
   */
  onPreview?: (color: string | null) => void;
}

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
}

/**
 * Preset swatch button chrome: hairline border, selected ring, and the synthetic
 * keyboard-focus ring — one place so every swatch stays visually consistent.
 */
const SwatchButton = forwardRef<HTMLButtonElement, SwatchButtonProps>(
  ({ selected, className, onFocus, onBlur, ...props }, ref) => {
    const kb = useKeyboardFocusRing();
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected}
        className={cn(
          SWATCH_HAIRLINE,
          selected && SWATCH_SELECTED,
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

/**
 * One panel, always in "custom" mode: the saturation/hue picker, the preset swatches, and a
 * hex field all edit the same draft, previewed live via `onPreview`. Picking a swatch loads it
 * into the draft (so it can be fine-tuned) rather than committing — Apply (or Enter in the hex
 * field) commits, Cancel discards. Mounted fresh each time the host popover opens, so the draft
 * is seeded from `value` once per open.
 */
export function ColorPicker({ value, onChange, onCancel, onPreview }: ColorPickerProps) {
  // Single source of truth for the in-progress edit, in the project's rgba() format —
  // the picker, swatches and hex field all read/write this (always opaque).
  const [draftRgba, setDraftRgba] = useState(value);
  // The hex string we last FED to react-colorful/HexColorInput as their `color` prop, kept
  // and fed back verbatim on every render rather than re-derived from `draftRgba` on every
  // render — re-deriving via rgbaToHex() hands them a brand-new (if value-equal) string each
  // time, and that plus their own onChange-on-external-change effect is exactly the shape of
  // loop the "Maximum update depth exceeded" bug came from. Keeping their own last-known
  // string stable means their internal `equal()` check short-circuits instead of re-diffing.
  const draftHexRef = useRef(rgbaToHex(value));

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

  // Clearing the preview must also drop any rAF still queued, or it would fire after the
  // clear and re-apply a stale colour.
  const clearPreview = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    onPreviewRef.current?.(null);
  }, []);

  // Clear any live preview when the picker unmounts (the host popover closing via Escape or
  // an outside click) so no stale preview lingers in the store.
  useEffect(() => clearPreview, [clearPreview]);

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

  // A swatch keeps its exact preset string (not a hex round-trip), so it still matches
  // PRESET_COLORS after Apply and shows as selected next time.
  const pickSwatch = (color: string) => {
    draftHexRef.current = rgbaToHex(color);
    setDraftRgba(color);
    schedulePreview(color);
  };

  const handleApply = () => {
    clearPreview();
    onChange(draftRgba);
  };

  const handleCancel = () => {
    clearPreview();
    onCancel?.();
  };

  // Radix's popover autofocus lands on the first focusable descendant (the saturation area).
  // Focus the swatch for the CURRENT colour instead when there is one, so arrow/Tab navigation
  // starts from what's selected. Whether that shows a ring is handled by useKeyboardFocusRing().
  const selectedSwatchRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedSwatchRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="w-50 space-y-2 p-2">
      <HexColorPicker
        color={draftHexRef.current}
        onChange={handleHexChange}
        style={{ width: '100%', height: 140 }}
      />

      <div className="grid grid-cols-6 justify-items-center gap-y-1.5">
        {PRESET_COLORS.map((color) => (
          <SwatchButton
            key={color}
            ref={value === color ? selectedSwatchRef : undefined}
            selected={draftRgba === color}
            onClick={() => pickSwatch(color)}
            className="h-6 w-6 rounded-full transition-transform hover:scale-110"
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span
          data-testid="color-draft-swatch"
          className={cn('h-4 w-4 shrink-0 rounded-full', SWATCH_HAIRLINE)}
          style={{ backgroundColor: draftRgba }}
          aria-hidden="true"
        />
        <HexColorInput
          prefixed
          color={draftHexRef.current}
          onChange={handleHexChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleApply();
          }}
          spellCheck={false}
          aria-label="Hex colour"
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
    </div>
  );
}
