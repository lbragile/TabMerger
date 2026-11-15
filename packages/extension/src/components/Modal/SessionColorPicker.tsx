import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Shuffle } from 'lucide-react';
import { AUTO_ITEM_COLORS } from '@tabmerger/shared';
import { autoColorName } from '@/lib/sessionColor';
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
 */
export function SessionColorPicker({ value, onChange }: SessionColorPickerProps) {
  const { t } = useTranslation();
  const name = useId();
  const labelId = `${name}-label`;
  const input = (choice: string, label: string) => (
    <input
      type="radio"
      name={name}
      value={choice}
      checked={value === choice}
      onChange={() => onChange(choice)}
      aria-label={label}
      className="peer sr-only"
    />
  );
  return (
    <div className="space-y-1.5 pb-4">
      <p id={labelId} className="text-sm font-medium leading-none">{t('sidePanel.sessionColor.label')}</p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1.5" data-testid="session-color-picker">
        <label className="relative inline-flex cursor-pointer">
          {input(RANDOM_SESSION_COLOR, t('sidePanel.sessionColor.random'))}
          <span
            aria-hidden
            className={cn(
              'inline-flex h-6 items-center gap-1 border border-border px-2 text-xs peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
              value === RANDOM_SESSION_COLOR ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            <Shuffle className="h-3 w-3" />
            {t('sidePanel.sessionColor.random')}
          </span>
        </label>
        {AUTO_ITEM_COLORS.map((color) => {
          const key = autoColorName(color);
          const label = key ? t(`sidePanel.sessionColor.names.${key}`) : color;
          return (
            <label key={color} className="relative inline-flex cursor-pointer" title={label}>
              {input(color, label)}
              <span
                aria-hidden
                className={cn(
                  'h-6 w-6 rounded-full border border-foreground/15 transition-transform hover:scale-110 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                  value === color && 'ring-1 ring-foreground ring-offset-1'
                )}
                style={{ backgroundColor: color }}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
