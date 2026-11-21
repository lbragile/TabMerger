import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Shuffle } from 'lucide-react';
import { AUTO_ITEM_COLORS } from '@tabmerger/shared';
import { autoColorName } from '@/lib/sessionColor';
import { readableTextColor } from '@/lib/color';
import { cn } from '@/lib/utils';

/** The "Random" choice: the colour is picked when the session is saved (never the last session's). */
export const RANDOM_SESSION_COLOR = 'random';

interface SessionColorPickerProps {
  /** A palette colour, or {@link RANDOM_SESSION_COLOR}. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * The Save session dialog's optional "Color" row: a radio group of "Random" (the default) and the
 * ten `AUTO_ITEM_COLORS`, drawn as round swatches like the group colour picker's. Native radios
 * (visually hidden, one tab stop, arrow keys move between them), each named by its colour.
 * Every swatch has a border of 3:1 or more against the dialog, the chosen one a 2px ring and a
 * check mark (black or white, whichever reads on that colour), and the name of the chosen colour,
 * or of the one keyboard focus is on, is written next to the label, so the choice never depends
 * on telling colours apart.
 */
export function SessionColorPicker({ value, onChange }: SessionColorPickerProps) {
  const { t } = useTranslation();
  const name = useId();
  const labelId = `${name}-label`;
  const [focused, setFocused] = useState<string | null>(null);
  const colorName = (choice: string) => {
    if (choice === RANDOM_SESSION_COLOR) return t('sidePanel.sessionColor.random');
    const key = autoColorName(choice);
    return key ? t(`sidePanel.sessionColor.names.${key}`) : choice;
  };
  const input = (choice: string) => (
    <input
      type="radio"
      name={name}
      value={choice}
      checked={value === choice}
      onChange={() => onChange(choice)}
      onFocus={() => setFocused(choice)}
      onBlur={() => setFocused(null)}
      aria-label={colorName(choice)}
      className="peer sr-only"
    />
  );
  return (
    <div className="space-y-1.5 pb-4">
      <div className="flex items-baseline gap-2">
        <p id={labelId} className="text-sm font-medium leading-none">{t('sidePanel.sessionColor.label')}</p>
        {/* the radios are named for screen readers already: this is for the eyes */}
        <span aria-hidden className="text-xs text-muted-foreground" data-testid="session-color-name">{colorName(focused ?? value)}</span>
      </div>
      {/* One row in every shipped locale: the dialog's content is 398px, ten swatches with gap-1.5
          take 300px, which leaves 98px for Random. px-1 on the chip fits the longest labels
          ("Случайный", "Ngẫu nhiên") even in wide fonts. The selected swatch's ring (4px) still
          clears its neighbours by 2px. flex-wrap is only a safety net. */}
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1.5" data-testid="session-color-picker">
        <label className="relative inline-flex cursor-pointer">
          {input(RANDOM_SESSION_COLOR)}
          <span
            aria-hidden
            className={cn(
              'inline-flex h-6 items-center gap-1 border px-1 text-xs peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
              value === RANDOM_SESSION_COLOR ? 'border-foreground bg-accent font-medium text-foreground ring-1 ring-foreground' : 'border-border text-muted-foreground'
            )}
          >
            <Shuffle className="h-3 w-3" />
            {t('sidePanel.sessionColor.random')}
          </span>
        </label>
        {AUTO_ITEM_COLORS.map((color) => {
          const selected = value === color;
          return (
            <label key={color} className="relative inline-flex cursor-pointer" title={colorName(color)}>
              {input(color)}
              <span
                aria-hidden
                className={cn(
                  // the border reaches 3:1 on the dialog whatever the swatch's own colour
                  'inline-flex h-6 w-6 items-center justify-center rounded-full border border-foreground/50 transition-transform hover:scale-110 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring',
                  selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                )}
                style={{ backgroundColor: color }}
              >
                {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} style={{ color: readableTextColor(color) }} />}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
