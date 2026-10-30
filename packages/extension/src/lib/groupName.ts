/**
 * A group name typed by the user, as the sidebar's inline rename keeps it: trimmed, `null` when
 * nothing is left (an empty rename changes nothing). Shared with the "Name this group" picker's
 * "type your own" box so both accept exactly the same names.
 */
export function typedGroupName(raw: string): string | null {
  const name = raw.trim();
  return name || null;
}
