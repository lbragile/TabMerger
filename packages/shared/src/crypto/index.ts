/**
 * Client-side E2E encryption primitives, shared between the extension
 * (MV3 service worker + popup) and the web app (Next.js client components).
 * Pure WebCrypto (`crypto.subtle`) — available natively in both environments,
 * no dependency needed. AES-256-GCM for data, PBKDF2-SHA256 for passphrase
 * key derivation, envelope-encrypted (a random data key wraps the content,
 * a passphrase-derived key wraps the data key).
 */

/** OWASP-recommended minimum PBKDF2-SHA256 iteration count (2023 guidance). */
export const KDF_ITERATIONS = 600_000

/**
 * Shape written to a jsonb content column (e.g. `groups.windows`) when
 * encryption is enabled. The `v` tag is what lets every reader — sync engine,
 * dashboard, share page, the organize workflow — distinguish an encrypted row
 * from a legacy plaintext one without a schema migration.
 */
export interface EncryptedBlob {
  v: 1
  iv: string
  ct: string
}

/**
 * True when a jsonb value is an {@link EncryptedBlob} rather than plaintext.
 * Lives here (not in the sync engine) because the server also needs it — it
 * can't decrypt, but it must be able to *detect* ciphertext and refuse to
 * write plaintext over it.
 */
export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as EncryptedBlob).v === 1 &&
    typeof (value as EncryptedBlob).ct === 'string'
  )
}

const AES_ALGO = 'AES-GCM'
const AES_LENGTH = 256
const IV_BYTES = 12

/** Browser-safe base64 encode — no Node `Buffer` (unavailable in MV3 service workers). */
function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Browser-safe base64 decode — inverse of {@link bufToBase64}. */
function base64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Derives an AES-256-GCM wrapping key from a user passphrase via PBKDF2-SHA256.
 * The result is non-extractable and can only wrap/unwrap other keys — it's
 * never used to encrypt data directly (envelope encryption).
 */
export async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number = KDF_ITERATIONS
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: AES_ALGO, length: AES_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  )
}

/** Generates a fresh random AES-256-GCM data key. Extractable so it can be wrapped. */
export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES_ALGO, length: AES_LENGTH }, true, [
    'encrypt',
    'decrypt',
  ])
}

/** Wraps (encrypts) a data key with a wrapping key. Returns base64 wrapped key + IV. */
export async function wrapDataKey(
  dataKey: CryptoKey,
  wrappingKey: CryptoKey
): Promise<{ wrappedKey: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, wrappingKey, {
    name: AES_ALGO,
    iv,
  })
  return { wrappedKey: bufToBase64(wrapped), iv: bufToBase64(iv) }
}

/**
 * Unwraps (decrypts) a data key previously wrapped by {@link wrapDataKey}.
 * Non-extractable by default — after unwrap it never needs to be exported
 * again, only used for encrypt/decrypt. The web app passes `extractable:
 * true` so it can export the key into `sessionStorage` for cross-navigation
 * caching (`chrome.storage.session` can hold a CryptoKey directly, so the
 * extension never needs this).
 */
export async function unwrapDataKey(
  wrappedKeyB64: string,
  ivB64: string,
  wrappingKey: CryptoKey,
  extractable = false
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    base64ToBuf(wrappedKeyB64),
    wrappingKey,
    { name: AES_ALGO, iv: base64ToBuf(ivB64) },
    { name: AES_ALGO, length: AES_LENGTH },
    extractable,
    ['encrypt', 'decrypt']
  )
}

/**
 * Exports an extractable AES-256-GCM data key as raw base64 — used to embed a
 * per-share key in a URL fragment (see {@link importKeyFromBase64}). Fragments
 * never leave the browser in HTTP requests, so this is safe to put in a link.
 */
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return bufToBase64(raw)
}

/** Inverse of {@link exportKeyToBase64} — re-imports a raw key from a URL fragment. */
export async function importKeyFromBase64(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64ToBuf(b64), { name: AES_ALGO, length: AES_LENGTH }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypts arbitrary JSON-serializable data with a data key. A fresh random
 * IV is generated per call — required for AES-GCM safety, and asserted by
 * tests (never reuse an IV with the same key).
 */
export async function encryptBlob(
  dataKey: CryptoKey,
  plaintext: unknown
): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext))
  const ct = await crypto.subtle.encrypt({ name: AES_ALGO, iv }, dataKey, encoded)
  return { iv: bufToBase64(iv), ct: bufToBase64(ct) }
}

/**
 * Decrypts a blob produced by {@link encryptBlob}. Throws (uncaught, not
 * swallowed) if the GCM auth tag fails to verify — wrong key or tampered
 * ciphertext — so callers can distinguish "bad data" from "no data".
 */
export async function decryptBlob<T>(
  dataKey: CryptoKey,
  encrypted: { iv: string; ct: string }
): Promise<T> {
  const plainBuf = await crypto.subtle.decrypt(
    { name: AES_ALGO, iv: base64ToBuf(encrypted.iv) },
    dataKey,
    base64ToBuf(encrypted.ct)
  )
  return JSON.parse(new TextDecoder().decode(plainBuf)) as T
}
