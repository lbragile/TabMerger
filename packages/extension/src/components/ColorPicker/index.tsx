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

export function ColorPicker({ value, onChange }: ColorPickerProps) {
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

      {/* Custom color input */}
      <div className="px-1 pb-1.5 pt-1 border-t border-border/50 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground shrink-0">Custom</span>
        <input
          type="color"
          value={rgbaToHex(value)}
          onChange={(e) => onChange(hexToRgba(e.target.value))}
          className="h-6 w-10 rounded cursor-pointer border border-border bg-transparent p-0.5"
          title="Pick a custom color"
        />
      </div>
    </div>
  );
}
