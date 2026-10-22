/**
 * Reading direction of the extension UI. `applyDocumentLocale` (lib/i18n.ts) sets `<html dir>`
 * from the active catalog (`rtl` for Arabic, Hebrew and Persian); layout follows it through
 * CSS logical properties, and the few pieces of code that deal in physical sides (arrow keys,
 * the tour card's corner, the drag image's grab point) ask here.
 *
 * Read from the document at the moment of use, not cached: the language (and so the direction)
 * can change while the popup is open (the header's language menu applies at once).
 */

export type TextDirection = 'ltr' | 'rtl';

/** The UI's reading direction: `<html dir>` of `doc`, `ltr` when unset or outside a page (the background worker). */
export function documentDirection(doc: Document | undefined = globalThis.document): TextDirection {
  return doc?.documentElement?.dir === 'rtl' ? 'rtl' : 'ltr';
}

/** True when the UI reads right to left. */
export function isRtl(doc?: Document): boolean {
  return documentDirection(doc) === 'rtl';
}

/**
 * A horizontal arrow key as a move along the reading direction: `end` = towards where the line
 * ends (ArrowRight in English, ArrowLeft in Hebrew), `start` = back towards where it starts.
 * Anything other than ArrowLeft / ArrowRight (by `key` or `code`) is null. Up and Down are
 * never flipped.
 */
export function inlineArrow(key: string, direction: TextDirection = documentDirection()): 'start' | 'end' | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const towardsRight = key === 'ArrowRight';
  return towardsRight === (direction === 'ltr') ? 'end' : 'start';
}
