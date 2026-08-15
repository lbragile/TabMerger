import { useState, useEffect } from 'react';
import { PRESET_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

/** Convert an rgba(R,G,B,1) string to a CSS hex color (#rrggbb). */
function rgbaToHex(rgba: string): string {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#808080';
  const [, r, g, b] = match;
  return (
    '#' +
    [r, g, b]
      .map((n) => parseInt(n, 10).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Convert a CSS hex color (#rrggbb or #rgb) to an rgba(R,G,B,1) string. */
function hexToRgba(hex: string): string {
  // Normalise shorthand #rgb → #rrggbb
  const full =
    hex.length === 4
      ? '#' + [...hex.slice(1)].map((c) => c + c).join('')
      : hex;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 1)`;
}

/** Return true if the string is a valid 3- or 6-digit hex colour. */
function isValidHex(hex: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [hexInput, setHexInput] = useState(() => rgbaToHex(value));

  // Sync hex input when the controlled value changes from outside (e.g. preset click)
  useEffect(() => {
    setHexInput(rgbaToHex(value));
  }, [value]);

  const applyHex = () => {
    const trimmed = hexInput.trim();
    if (isValidHex(trimmed)) {
      onChange(hexToRgba(trimmed));
    } else {
      // Reset to match the current value
      setHexInput(rgbaToHex(value));
    }
  };

  // Preview colour: use the typed hex if valid, otherwise fall back to current value
  const previewColor = isValidHex(hexInput.trim()) ? hexInput.trim() : rgbaToHex(value);

  return (
    <div>
      {/* Preset swatches */}
      <div className="grid grid-cols-6 gap-1.5 p-1">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            className={cn(
              'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
              value === color ? 'border-foreground scale-110' : 'border-transparent'
            )}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      {/* Custom hex text input — stays within the popup DOM, no system dialog */}
      <div className="px-1 pb-1.5 pt-1 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground shrink-0">Custom</span>
        {/* Live colour preview swatch */}
        <span
          className="h-4 w-4 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: previewColor }}
        />
        <input
          type="text"
          value={hexInput}
          placeholder="#rrggbb"
          spellCheck={false}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={applyHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyHex();
          }}
          className="h-6 flex-1 min-w-0 border border-border bg-transparent px-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          title="Enter hex colour (#rrggbb)"
        />
      </div>
    </div>
  );
}
