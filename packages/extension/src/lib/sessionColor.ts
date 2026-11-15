import { AUTO_ITEM_COLORS, colorForId, isAutoItemColor } from '@tabmerger/shared';
import type { Session } from '@/lib/types';

/**
 * Session colours. A session's `color` is one of `AUTO_ITEM_COLORS` or absent: whatever is read
 * (IndexedDB, a decrypted download) goes through {@link withValidSessionColor}, so a value that is
 * not in the palette (an old build, a hand-edited row, another client) never reaches a `style`.
 */

/** The stored colour when it is one of the palette's, else `undefined`. */
export function validSessionColor(value: unknown): string | undefined {
  return isAutoItemColor(value) ? value : undefined;
}

/** `session` with its `color` kept only when it is valid (the same object when nothing changes). */
export function withValidSessionColor<S extends Pick<Session, 'color'>>(session: S): S {
  if (session.color === undefined || isAutoItemColor(session.color)) return session;
  const { color: _dropped, ...rest } = session;
  return rest as S;
}

/** The colour a session is shown in: its own, else the stable colour of its id (nothing is written back). */
export function sessionDisplayColor(session: Pick<Session, 'id' | 'color'>): string {
  return validSessionColor(session.color) ?? colorForId(session.id);
}

/** The palette's colour names, in `AUTO_ITEM_COLORS` order (keys of `sidePanel.sessionColor.names`). */
const AUTO_COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'teal'] as const;
export type AutoColorName = (typeof AUTO_COLOR_NAMES)[number];

/** The name key of a palette colour ("red"), or `undefined` for a colour outside it. */
export function autoColorName(color: string): AutoColorName | undefined {
  const at = AUTO_ITEM_COLORS.indexOf(color);
  return at >= 0 ? AUTO_COLOR_NAMES[at] : undefined;
}
