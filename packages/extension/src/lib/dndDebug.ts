/**
 * Opt-in drag-and-drop instrumentation.
 *
 * Off by default — there is NO console output for normal users. Turn it on by
 * running this in the popup devtools console (or the page console when
 * `popup.html` is opened as a tab):
 *
 *   localStorage.setItem('tm_dnd_debug', '1')
 *
 * then re-open the popup and attempt a single drag. Every sensor / handler
 * lifecycle point logs `[tm-dnd] <stage> <detail>` and the last stage reached is
 * mirrored into a fixed bottom-right corner chip so it can be read without
 * devtools attached (devtools can't stay attached to a real MV3 action popup).
 *
 * Disable again with `localStorage.removeItem('tm_dnd_debug')`.
 *
 * The flag is also mirrored from `chrome.storage.local` on module load so it can
 * be flipped from an env where `localStorage` isn't reachable; `localStorage`
 * remains the authoritative synchronous source.
 */

const FLAG = 'tm_dnd_debug';

let cachedEnabled: boolean | null = null;

function readLocalStorageFlag(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const v = localStorage.getItem(FLAG);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

// Best-effort async mirror: if chrome.storage.local has the flag set, honour it
// even when localStorage was never written in this context.
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(FLAG).then((res) => {
      const v = res?.[FLAG];
      if (v === true || v === '1' || v === 'true') {
        try {
          localStorage.setItem(FLAG, '1');
        } catch {
          /* ignore */
        }
        cachedEnabled = true;
      }
    }).catch(() => {
      /* ignore */
    });
  }
} catch {
  /* ignore */
}

export function dndDebugEnabled(): boolean {
  if (cachedEnabled === null) cachedEnabled = readLocalStorageFlag();
  return cachedEnabled;
}

/** Test/dev hook to force a re-read of the flag. */
export function resetDndDebugCache(): void {
  cachedEnabled = null;
}

let chipEl: HTMLDivElement | null = null;

function ensureChip(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (chipEl && chipEl.isConnected) return chipEl;
  chipEl = document.createElement('div');
  chipEl.id = 'tm-dnd-debug-chip';
  Object.assign(chipEl.style, {
    position: 'fixed',
    bottom: '4px',
    right: '4px',
    zIndex: '2147483647',
    font: '10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
    background: 'rgba(0,0,0,0.82)',
    color: '#3ecf5c',
    padding: '2px 5px',
    borderRadius: '3px',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    maxWidth: '60vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(chipEl);
  return chipEl;
}

/**
 * Write `text` into the corner chip, bypassing the `tm_dnd_debug` gate — the
 * CALLER owns gating (used by the flag-gated `@/lib/dndPointerProbe`). With
 * `selectable`, the chip wraps and accepts pointer/selection so its text can be
 * copied straight out of the popup without devtools.
 */
export function showDndDebugChip(text: string, opts: { selectable?: boolean } = {}): void {
  try {
    const chip = ensureChip();
    if (!chip) return;
    chip.textContent = text;
    if (opts.selectable) {
      Object.assign(chip.style, {
        pointerEvents: 'auto',
        userSelect: 'text',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxWidth: '96vw',
        textOverflow: 'clip'
      } as Partial<CSSStyleDeclaration>);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Log a DnD lifecycle stage. No-op unless the `tm_dnd_debug` flag is set.
 *
 * EVERY drag opens with the dual-path decision line from `@/lib/dndPressTracker`:
 *   `path:native  {movesSeen, dist, ms, sinceMoveMs, pressValid, forced}`
 *   `path:pointer {…}`
 * `movesSeen` is how many `pointermove`s the popup delivered between `pointerdown`
 * and `dragstart`. **This single line settles spec C1**: `path:native {movesSeen:0|1}`
 * on every drag means the popup really does withhold the pointer stream; anything
 * ≥2 means it never did and the pointer path (hence `cursor: grabbing`) is live.
 *
 * Stages a healthy drag hits, in order — NATIVE path (`@/lib/dndHtml5Sensor`):
 *   path:native → html5:dragstart → onDragStart → onDragOver:first → html5:drop
 *   → onDragEnd → committed
 * (`html5:dragend` trails; `html5:escape` + onDragCancel on an aborted drag.)
 *
 * POINTER path (same sensor, native drag suppressed):
 *   path:pointer → pointer:dragstart → onDragStart → onDragOver:first
 *   → pointer:drop → onDragEnd → committed
 * (`pointer:cancel` / `pointer:escape` on an aborted drag;
 * `pointer:native-drag-suppressed` if anything tried to open a native drag mid-drag.)
 * The MV3 popup throttles `dragover` — `onDragOver:first`'s `over` is often the
 * SOURCE row; the real target is resolved from the `html5:drop` (or `html5:dragend`)
 * coordinates, so `onDragEnd`'s `rawOverId` is the one that matters.
 *
 * Interpreting a stuck drag:
 *   - NOTHING logged when you press+drag a grip → the native `dragstart` never
 *     fired: the handle is missing its `draggable` attr, or something upstream
 *     called `preventDefault()` on `dragstart`.
 *   - `html5:dragstart` but no `onDragStart` → dnd-kit didn't accept activation.
 *   - `onDragStart` but no `onDragOver:first` → `dragover` events aren't
 *     reaching the document at all.
 *   - `dragend {dropEffect:'none'}` and NO `html5:drop` → Chrome refused the
 *     drop: a `dragenter`/`dragover` didn't `preventDefault()` + set
 *     `dataTransfer.dropEffect='move'`, OR the dragged DOM node was
 *     re-rendered/reparented mid-drag (a CSS `transform` on it, or a list
 *     reflow) and Chrome aborted the native drag.
 *   - `html5:drop` but no `committed` → the move resolved to a no-op (dropped on
 *     the source), or dnd-kit's DragEnd handler had no `scrollAdjustedTranslate`
 *     (the sensor defers `onEnd` one macrotask to avoid the latter).
 *
 * The legacy pointer-capture sensor (`@/lib/dndPointerSensor`, no longer wired)
 * logged: press-registered → pointer-capture-set → first-move-seen → onDragStart
 * → onDragOver → onDragEnd → pointer-capture-released.
 */
export function dndDebugLog(stage: string, detail?: unknown): void {
  if (!dndDebugEnabled()) return;
  try {
     
    console.log('[tm-dnd]', stage, detail ?? '');
  } catch {
    /* ignore */
  }
  // Ring buffer on the window so a CDP-attached harness can read the sequence
  // back with a single `Runtime.evaluate` (console-event subscription is fussy;
  // the real MV3 action popup can't keep devtools attached). No-op unless the
  // debug flag is on, so it never allocates for real users.
  try {
    const g = globalThis as unknown as { __tmDndLog?: Array<[number, string, unknown]> };
    (g.__tmDndLog ??= []).push([Date.now(), stage, detail ?? null]);
    if (g.__tmDndLog.length > 200) g.__tmDndLog.shift();
  } catch {
    /* ignore */
  }
  try {
    const chip = ensureChip();
    if (chip) {
      const ts = new Date().toISOString().slice(11, 23);
      chip.textContent = `[tm-dnd] ${stage}  ${ts}`;
    }
  } catch {
    /* ignore */
  }
}
