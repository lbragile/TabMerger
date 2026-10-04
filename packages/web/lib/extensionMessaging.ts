import { EXTENSION_IDS } from '@/lib/extensionId'
import { WEB_BRIDGE } from '@tabmerger/shared'

// ponytail: no @types/chrome dep in this package — minimal ambient shape for the
// one API surface we touch (externally_connectable sendMessage probe).
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback: (response?: unknown) => void
        ) => void
        lastError?: { message?: string }
      }
    }
  }
  const chrome: Window['chrome']
}

const PER_ATTEMPT_TIMEOUT_MS = 1500

// Sentinel "id" used to cache the postMessage transport (Firefox — no chrome.runtime from a
// web page) the same way a real Chrome/Edge extension ID is cached.
const POSTMESSAGE_TRANSPORT_ID = '__tabmerger_postmessage__'

export interface ExtensionMessageResult<T = unknown> {
  id: string
  response: T | undefined
}

export interface KnownExtensionSendOptions {
  /**
   * How long to wait for the reply. Defaults to the short probe timeout, which suits messages
   * answered at once (PING, SYNC_AUTH). A message whose reply follows real work (SYNC_NOW runs a
   * full push and pull) needs longer, or the reply is dropped and the sender is told the
   * extension is gone.
   */
  timeoutMs?: number
}

// Cached for the session so once we know which store the extension came from,
// later calls (SYNC_NOW, etc.) go straight to it instead of re-probing every ID.
let cachedResponderId: string | null = null

/** Test-only escape hatch — production code should never need to reset this. */
export function _resetExtensionIdCache(): void {
  cachedResponderId = null
  postMessageDetected = false
  pendingPostMessageRequests.clear()
}

function getRuntime(): NonNullable<Window['chrome']>['runtime'] | undefined {
  return typeof chrome === 'undefined' ? undefined : chrome.runtime
}

// Wraps the outcome so a legitimate `undefined` response (e.g. SYNC_AUTH's handler never
// calls sendResponse) can be told apart from "this ID didn't answer at all".
type Attempt<T> = { ok: true; response: T | undefined } | { ok: false }

function attemptRuntime<T>(
  id: string,
  message: unknown,
  timeoutMs: number = PER_ATTEMPT_TIMEOUT_MS
): Promise<Attempt<T>> {
  return new Promise((resolve) => {
    const runtime = getRuntime()
    if (!runtime?.sendMessage) {
      resolve({ ok: false })
      return
    }

    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ ok: false })
    }, timeoutMs)

    try {
      runtime.sendMessage(id, message, (response) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        // Must read lastError even though we ignore it, or Chrome logs an unhandled warning.
        if (runtime.lastError) {
          resolve({ ok: false })
          return
        }
        resolve({ ok: true, response: response as T | undefined })
      })
    } catch {
      // Thrown synchronously on non-Chromium browsers or malformed IDs — treat as "not this one".
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        resolve({ ok: false })
      }
    }
  })
}

// ---- postMessage transport (Firefox) ----------------------------------------------------
//
// Firefox extensions can't be reached with chrome.runtime.sendMessage from a regular web page
// (no externally_connectable equivalent), so the Firefox build runs a content script on this
// origin that relays messages via window.postMessage. Protocol (fixed, extension side owns the
// other end):
//   page -> extension: { source: 'tabmerger-web', requestId, type, payload }
//   extension -> page: { source: 'tabmerger-extension', requestId, response }
//   extension -> page (once, on content script load): { source: 'tabmerger-extension', type: 'READY', version }

interface PostMessageReplyData {
  source?: string
  requestId?: string
  response?: unknown
  type?: string
  version?: string
}

const pendingPostMessageRequests = new Map<string, (response: unknown) => void>()
const readyListeners = new Set<() => void>()

// Set the instant we see either a READY announcement or a successful reply — this is the
// "the extension has shown itself" gate SYNC_AUTH's cache-only send relies on.
let postMessageDetected = false

function notifyReady() {
  for (const listener of readyListeners) listener()
}

function handleIncomingPostMessage(event: MessageEvent) {
  if (event.source !== window) return
  if (event.origin !== window.location.origin) return
  const data = event.data as PostMessageReplyData | undefined
  if (!data || data.source !== WEB_BRIDGE.EXTENSION_SOURCE) return

  if (data.type === WEB_BRIDGE.READY) {
    // The relay content script ships in Firefox builds only. A browser with page-to-extension
    // runtime messaging (Chrome, Edge, Brave…) never needs this transport, so a READY there is
    // ignored: otherwise any script on the page could post one and divert later messages,
    // SYNC_AUTH included, away from the real extension.
    if (getRuntime()?.sendMessage) return
    const wasDetected = postMessageDetected
    postMessageDetected = true
    cachedResponderId = POSTMESSAGE_TRANSPORT_ID
    if (!wasDetected) notifyReady()
    return
  }

  if (!data.requestId) return
  const resolve = pendingPostMessageRequests.get(data.requestId)
  if (!resolve) return
  pendingPostMessageRequests.delete(data.requestId)
  resolve(data.response)
}

// Registered once at module scope (not inside a hook effect) so a READY announcement that
// fires before any component mounts — or before useExtensionInstalled mounts specifically —
// still gets picked up; onExtensionReady() below replays it to late subscribers.
if (typeof window !== 'undefined') {
  window.addEventListener('message', handleIncomingPostMessage)
}

function randomRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function attemptPostMessage<T>(message: unknown, timeoutMs: number = PER_ATTEMPT_TIMEOUT_MS): Promise<Attempt<T>> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false })
      return
    }

    const requestId = randomRequestId()
    const { type, ...payload } = (message ?? {}) as { type?: string; [key: string]: unknown }

    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pendingPostMessageRequests.delete(requestId)
      resolve({ ok: false })
    }, timeoutMs)

    pendingPostMessageRequests.set(requestId, (response) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      postMessageDetected = true
      resolve({ ok: true, response: response as T | undefined })
    })

    // targetOrigin is always this page's own origin — never '*' — since the relay is only
    // ever the content script this same origin's extension injected.
    window.postMessage({ source: WEB_BRIDGE.WEBSITE_SOURCE, requestId, type, payload }, window.location.origin)
  })
}

/**
 * Subscribes to the Firefox content-script relay's one-time `READY` announcement, which — like
 * a successful `PING` reply on Chromium — means a real TabMerger extension is present. Fires
 * immediately if `READY` already arrived before this call (module-scope listener means it isn't
 * missed even if it fires before any component mounts). Returns an unsubscribe function.
 */
export function onExtensionReady(callback: () => void): () => void {
  readyListeners.add(callback)
  if (postMessageDetected) callback()
  return () => {
    readyListeners.delete(callback)
  }
}

async function attemptById<T>(id: string, message: unknown, timeoutMs?: number): Promise<Attempt<T>> {
  return id === POSTMESSAGE_TRANSPORT_ID
    ? attemptPostMessage<T>(message, timeoutMs)
    : attemptRuntime<T>(id, message, timeoutMs)
}

/**
 * Sends `message` to the TabMerger extension, trying each known extension ID
 * (`EXTENSION_IDS` — Chrome Web Store, Edge Add-ons, dev) in order until one
 * responds via `chrome.runtime.sendMessage`. If `chrome.runtime` is unavailable
 * (Firefox, or any non-Chromium browser) or none of those IDs answer, falls
 * back to the postMessage relay a Firefox content script provides. Resolves
 * with `{ id, response }` for the first responder, or `null` if nothing
 * answers on either transport.
 *
 * The responding ID (or the postMessage sentinel) is cached for the session
 * (`getCachedExtensionId`) so subsequent calls — e.g. SYNC_NOW after a PING
 * already succeeded — skip straight to it. If the cached responder stops
 * answering, the cache is cleared and every option is retried.
 */
export async function sendToExtension<T = unknown>(message: unknown): Promise<ExtensionMessageResult<T> | null> {
  if (cachedResponderId) {
    const result = await attemptById<T>(cachedResponderId, message)
    if (result.ok) return { id: cachedResponderId, response: result.response }
    cachedResponderId = null
  }

  if (getRuntime()?.sendMessage) {
    for (const id of EXTENSION_IDS) {
      const result = await attemptRuntime<T>(id, message)
      if (result.ok) {
        cachedResponderId = id
        return { id, response: result.response }
      }
    }
  }

  const pmResult = await attemptPostMessage<T>(message)
  if (pmResult.ok) {
    cachedResponderId = POSTMESSAGE_TRANSPORT_ID
    return { id: POSTMESSAGE_TRANSPORT_ID, response: pmResult.response }
  }

  return null
}

/** The extension ID (or the postMessage transport sentinel) that most recently answered a
 * message this session, if any. */
export function getCachedExtensionId(): string | null {
  return cachedResponderId
}

/**
 * Sends `message` ONLY to the already-cached responder (the ID — or the
 * postMessage transport — that previously answered PING/READY). Never sprays
 * a message across every known ID or speculatively over postMessage. Use this
 * for anything carrying sensitive payloads (e.g. SYNC_AUTH session tokens) —
 * we must not hand a live session to a transport we haven't confirmed is
 * actually an installed, reachable TabMerger extension.
 *
 * Resolves `null` if there is no cached responder or it stops answering.
 *
 * `options.timeoutMs` is offered here only, never on `sendToExtension`: a long wait is safe for
 * one confirmed responder, but would hang for that long on every unanswered ID when probing.
 */
export async function sendToKnownExtension<T = unknown>(
  message: unknown,
  options: KnownExtensionSendOptions = {}
): Promise<ExtensionMessageResult<T> | null> {
  const id = cachedResponderId
  if (!id) return null
  const result = await attemptById<T>(id, message, options.timeoutMs)
  if (!result.ok) {
    // Only forget the responder this call used: another call may have cached a new one meanwhile.
    if (cachedResponderId === id) cachedResponderId = null
    return null
  }
  return { id, response: result.response }
}
