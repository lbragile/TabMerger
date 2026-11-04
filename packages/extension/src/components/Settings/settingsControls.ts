/**
 * The width of every dropdown in a Settings row, so the controls line up in one column. Fits the
 * short values (theme, search, intervals); a long language name ("Português (Brasil)") is cut with
 * an ellipsis in the closed picker, and the open list shows it in full.
 */
export const SETTINGS_SELECT_WIDTH = 'w-32';

/**
 * The one width of both Settings → AI dropdowns (provider, model), so they line up and never
 * change width with the choice: 12rem. {@link SETTINGS_SELECT_WIDTH} (8rem) is too narrow for model
 * names and translated placeholders. Measured at the triggers' `text-xs` in the popup font, the
 * longest value is the French placeholder "Choisissez un fournisseur" (≈ 133px), then Persian
 * (≈ 127px), Russian (≈ 124px) and the longest model name "Gemini 3.1 Flash-Lite" (≈ 110px); with
 * the trigger's padding, gap, chevron and border (50px) that is ≈ 183px of the 192px. A longer
 * value (a new model or translation) is cut with an ellipsis, and the trigger's `title` holds the
 * full text.
 */
export const AI_SELECT_WIDTH = 'w-48';

/**
 * The Settings → AI dropdown triggers: the row look of the General dropdowns at
 * {@link AI_SELECT_WIDTH}. The value is one line cut with an ellipsis (the shared trigger's
 * line clamp swapped for `truncate`, which an ellipsis needs). The placeholder ("Choose a
 * provider") is muted like an empty field.
 */
export const AI_SELECT_TRIGGER_CLASS = `h-7 ${AI_SELECT_WIDTH} shrink-0 gap-2 text-xs data-[placeholder]:text-muted-foreground [&>span]:min-w-0 [&>span]:line-clamp-none [&>span]:truncate`;

/**
 * The open list of a Settings → AI dropdown. It is portaled out of the Settings dialog (so the
 * dialog's `overflow-hidden` never clips it) and kept inside the fixed 800×600 popup by Radix's
 * collision handling plus these caps on the space Radix reports as available.
 */
export const AI_SELECT_CONTENT_CLASS =
  'max-h-[min(24rem,var(--radix-select-content-available-height))] max-w-(--radix-select-content-available-width)';
