/**
 * Sensor-agnostic multi-item drag registry.
 *
 * `useDndHandlers.onDragStart` records the model ids of the dragged selection here
 * (synchronously inside the sensor's `onStart`), and three consumers read it without
 * knowing about React or the store:
 *   - the drag sensor's visuals (`dndDragVisuals`): which extra rows to collapse at
 *     pickup and the ghost's `+N` count badge
 *   - the collision layer (`DndProvider`): collapsed selected rows are zero-height in
 *     the virtual geometry and are never "others" the insertion gap sits between
 *
 * Kept out of `dndHtml5Sensor.ts` on purpose: if a pointer-driven sensor ever replaces
 * the native HTML5 one (spec §10 pointer probe), it reuses this + `dndDragVisuals` as-is.
 *
 * Rows are found through the STATIC `data-tm-dnd-id` attribute (= the sortable model id)
 * — reading it never mutates the DOM, so it is safe during `dragstart` (spec C4).
 */

// ─── live-drag flag ──────────────────────────────────────────────────────────
//
// Set synchronously in `onDragStart` (for every sensor) and cleared in the handlers'
// `reset`. Global keyboard shortcuts read it: dnd-kit's KeyboardSensor attaches its own
// document `keydown` listener in a `setTimeout` at pickup, so any document listener
// registered earlier (`useKeyboardNav`) sees each Arrow key FIRST — switching the active
// group mid-drag unmounts the dragged row.

export type DndDragKind = 'keyboard' | 'pointer';
let liveDrag: DndDragKind | null = null;

export function setDndDragLive(kind: DndDragKind): void {
  liveDrag = kind;
}

export function clearDndDragLive(): void {
  liveDrag = null;
}

/** True while any drag (native, touch or keyboard) is in progress. */
export function isDndDragLive(): boolean {
  return liveDrag !== null;
}

/** True while a KEYBOARD drag is in progress (no native drag session, so spec C4 doesn't apply). */
export function isDndKeyboardDrag(): boolean {
  return liveDrag === 'keyboard';
}

/** Attribute every sortable tab/window row carries: its positional model id. */
export const DND_ROW_ID_ATTR = 'data-tm-dnd-id';

let selection: { primaryId: string; ids: ReadonlySet<string> } | null = null;

/** Record the drag's selection. `ids` of length ≤ 1 (or none) means a single-item drag. */
export function setDndDragSelection(primaryId: string, ids: readonly string[] | null | undefined): void {
  selection = ids && ids.length > 1 ? { primaryId, ids: new Set(ids) } : null;
}

export function clearDndDragSelection(): void {
  selection = null;
}

/** Every dragged model id (primary included) for a multi-item drag, else `null`. */
export function getDndDragSelection(): ReadonlySet<string> | null {
  return selection?.ids ?? null;
}

/** Number of items being dragged (1 for a single-item drag). */
export function getDndDragCount(): number {
  return selection?.ids.size ?? 1;
}

/**
 * The rendered rows of the selection other than `exclude` (the primary's row), in DOM
 * order. Selected items that aren't rendered (another group's panel) are simply absent.
 */
export function findSelectionRows(root: ParentNode | null, exclude?: Element | null): HTMLElement[] {
  const ids = selection?.ids;
  if (!ids || !root || typeof root.querySelectorAll !== 'function') return [];
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(`[${DND_ROW_ID_ATTR}]`).forEach((el) => {
    if (el !== exclude && ids.has(el.getAttribute(DND_ROW_ID_ATTR) ?? '')) out.push(el);
  });
  return out;
}
