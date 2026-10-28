/**
 * The width of every dropdown in a Settings row, so the controls line up in one column. Fits the
 * short values (theme, search, intervals); a long language name ("Português (Brasil)") is cut with
 * an ellipsis in the closed picker, and the open list shows it in full.
 */
export const SETTINGS_SELECT_WIDTH = 'w-32';

/**
 * The Settings → AI dropdowns (provider, model): the row look of the General dropdowns, but sized
 * to their value, since model names ("Gemini 3.1 Flash-Lite") and some translated placeholders
 * don't fit {@link SETTINGS_SELECT_WIDTH}. Never narrower than it (`min-w-32` is the same 8rem),
 * never wider than most of the row, so the heading beside it keeps room. The placeholder ("Choose
 * a provider") is muted like an empty field.
 */
export const AI_SELECT_TRIGGER_CLASS =
  'h-7 w-auto min-w-32 max-w-[60%] shrink-0 gap-2 text-xs data-[placeholder]:text-muted-foreground [&>span]:min-w-0';

/**
 * The open list of a Settings → AI dropdown. It is portaled out of the Settings dialog (so the
 * dialog's `overflow-hidden` never clips it) and kept inside the fixed 800×600 popup by Radix's
 * collision handling plus these caps on the space Radix reports as available.
 */
export const AI_SELECT_CONTENT_CLASS =
  'max-h-[min(24rem,var(--radix-select-content-available-height))] max-w-(--radix-select-content-available-width)';
