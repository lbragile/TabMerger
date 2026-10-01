/**
 * Minimal hand-rolled Chrome DevTools Protocol client.
 *
 * WHY THIS EXISTS: Playwright never surfaces the real MV3 *toolbar action popup*
 * as a `Page` — not via `context.pages()`, `context.waitForEvent('page')`, nor
 * `chromium.connectOverCDP`. The popup IS a first-class CDP `page` target with its
 * own `webSocketDebuggerUrl`, so this connects straight to that per-page endpoint
 * (no session-id routing needed) and drives it with `Input.dispatchMouseEvent` +
 * `Runtime.evaluate`. Used only by `tests/popup-dnd.spec.ts`.
 *
 * Node 22+ ships a global `WebSocket` and `fetch`, so there are zero deps here.
 */

interface CdpPageTarget {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/** Message of the rejection raised for calls on a closed/closing CDP target. */
export const CDP_TARGET_CLOSED = 'CDP target closed';

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };

export class RawCdp {
  private readonly ws: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.onmessage = (ev: MessageEvent) => this.onMessage(String(ev.data));
    // The target going away (e.g. a toolbar popup dismissed because the page opened a tab)
    // must fail every in-flight call instead of leaving it pending until the test timeout.
    this.ws.onclose = () => this.failPending();
    this.ws.addEventListener('error', () => this.failPending());
  }

  /** True once the socket is closing/closed (target gone or `close()` called). */
  get closed(): boolean {
    return this.ws.readyState !== WebSocket.OPEN;
  }

  private failPending(): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(new Error(CDP_TARGET_CLOSED));
  }

  /**
   * Poll `http://127.0.0.1:<port>/json` until a `page` target whose URL ends with
   * `urlSuffix` appears, then open a WebSocket to its debugger URL.
   */
  static async attach(port: number, urlSuffix: string, timeoutMs = 15_000): Promise<RawCdp> {
    const deadline = Date.now() + timeoutMs;
    let target: CdpPageTarget | undefined;
    while (Date.now() < deadline) {
      // Right after launch the DevTools HTTP endpoint can refuse the connection or
      // answer with an EMPTY body ("Unexpected end of JSON input") — both mean
      // "not ready yet", so keep polling instead of failing the whole test.
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const list = JSON.parse((await res.text()) || '[]') as CdpPageTarget[];
        target = list.find((t) => t.type === 'page' && t.url.endsWith(urlSuffix));
        if (target?.webSocketDebuggerUrl) break;
      } catch {
        /* transient — retry until the deadline */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!target?.webSocketDebuggerUrl) {
      throw new Error(`no CDP page target ending in "${urlSuffix}" after ${timeoutMs}ms`);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('CDP websocket failed to open'));
    });
    return new RawCdp(ws);
  }

  private readonly listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  /** Subscribe to a CDP event (e.g. `Page.screencastFrame`). Returns an unsubscribe fn. */
  on(method: string, cb: (params: Record<string, unknown>) => void): () => void {
    let set = this.listeners.get(method);
    if (!set) this.listeners.set(method, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  private onMessage(data: string): void {
    const msg = JSON.parse(data) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      error?: { message: string };
      result?: Record<string, unknown>;
    };
    if (typeof msg.id !== 'number') {
      if (msg.method) this.listeners.get(msg.method)?.forEach((cb) => cb(msg.params ?? {}));
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result ?? {});
  }

  /**
   * Send one CDP command. Rejects with "CDP target closed" if the socket is not OPEN (now or
   * while waiting), and with a timeout error after `timeoutMs` (default 30s) so a hung call can
   * never outlive the test.
   */
  send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error(CDP_TARGET_CLOSED));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(CDP_TARGET_CLOSED));
      }
    });
  }

  /** `Runtime.evaluate` with `returnByValue` + `awaitPromise`; throws on JS exceptions. */
  async evaluate<T>(expression: string): Promise<T> {
    const r = (await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluate failed',
      );
    }
    return r.result?.value as T;
  }

  private mouse(
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved',
    x: number,
    y: number,
  ): Promise<Record<string, unknown>> {
    return this.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  }

  /**
   * Real pointer-ish drag: press at `from`, nudge past the sensor's activation
   * threshold, run `onMid` (assert the drag actually started), travel to `to`,
   * release. Mirrors the `page.mouse.*` sequence the tab-based DnD specs use.
   */
  async drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    onMid?: () => Promise<void>,
  ): Promise<void> {
    await this.mouse('mouseMoved', from.x, from.y);
    await this.mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= 4; i++) {
      await this.mouse('mouseMoved', from.x, from.y + i * 4);
    }
    if (onMid) await onMid();
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await this.mouse(
        'mouseMoved',
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      );
    }
    await this.mouse('mouseReleased', to.x, to.y);
  }

  /** Idempotent: harmless on an already-closed socket. */
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
    this.failPending();
  }
}
