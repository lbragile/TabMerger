import { getEncryptionKeyState, getDataKey } from './encryptionKey';

/**
 * Why content may not be uploaded right now:
 *  - `no-key`: the account has not finished encryption setup (the server answered: no key);
 *  - `unknown`: the key check failed (offline, timeout, 401, 5xx);
 *  - `locked`: a key exists, but this device has not unlocked it.
 */
export type UploadBlockedReason = 'no-key' | 'unknown' | 'locked';

export const UPLOAD_BLOCKED_MESSAGE: Record<UploadBlockedReason, string> = {
  'no-key': 'encryption setup is not finished',
  unknown: 'the encryption status could not be checked',
  locked: 'the encryption key is locked on this device'
};

export type ContentUploadGate = { key: CryptoKey } | { key: null; reason: UploadBlockedReason };

/**
 * THE gate for every upload of user content (group `windows/name/note/info`, session
 * `groups/name/description`, `device_sessions.now_open_snapshot`): the key to encrypt with, or
 * the reason nothing may be sent.
 *
 * End-to-end encryption is mandatory, so there is NO plaintext branch: without an unlocked key
 * the upload is skipped and the data stays pending locally (groups keep `pendingSync`, sessions
 * re-arm their self-heal) until setup / unlock completes, which then uploads everything
 * encrypted. Plaintext metadata (`position`, counts, colour, device name) is not content and
 * does not go through here.
 *
 * `expectedUserId`: the account the caller is acting for. Both lookups below resolve the user
 * from the client's CURRENT session, which can change while a caller runs (the web app hands the
 * worker another session, the popup signs out). With it, a key is only ever returned for that
 * account: if someone else (or nobody) is signed in when either lookup runs, the answer is
 * `unknown` or `locked` and nothing is uploaded, never another account's key.
 */
export async function getContentUploadKey(expectedUserId?: string): Promise<ContentUploadGate> {
  const state = await getEncryptionKeyState(expectedUserId);
  if (state !== 'present') return { key: null, reason: state === 'absent' ? 'no-key' : 'unknown' };
  try {
    const key = await getDataKey(expectedUserId);
    return key ? { key } : { key: null, reason: 'locked' };
  } catch {
    // unreadable / corrupt stored key: same as never unlocked
    return { key: null, reason: 'locked' };
  }
}
