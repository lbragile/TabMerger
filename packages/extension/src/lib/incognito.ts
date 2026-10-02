import { toast } from '@/lib/toast';

/** Fixed toast id so a restore that reopens several incognito windows shows the notice once. */
const INCOGNITO_NOT_ALLOWED_TOAST_ID = 'incognito-not-allowed';

/**
 * Whether the user has enabled the extension in incognito (Chrome: "Allow in Incognito";
 * Firefox: "Run in Private Windows"). `chrome.windows.create({ incognito: true })` rejects
 * otherwise. Any failure or a missing API counts as "not allowed" so callers fall back to a
 * normal window instead of throwing.
 */
export async function isIncognitoAllowed(): Promise<boolean> {
  try {
    const ext = (globalThis as { chrome?: typeof chrome }).chrome?.extension;
    if (typeof ext?.isAllowedIncognitoAccess !== 'function') return false;
    return !!(await ext.isAllowedIncognitoAccess());
  } catch {
    return false;
  }
}

/**
 * Resolves the `incognito` flag to pass to `chrome.windows.create` when reopening a saved
 * window. Returns `true` only when the saved window was incognito AND the extension may open
 * incognito windows; if it was incognito but isn't allowed, falls back to `false` (a normal
 * window) and tells the user why. Always `false` for a non-incognito saved window.
 */
export async function resolveIncognito(wasIncognito: boolean | undefined): Promise<boolean> {
  if (!wasIncognito) return false;
  if (await isIncognitoAllowed()) return true;
  toast.info(
    'Opened as a normal window because TabMerger isn\'t allowed in incognito. To change this, open Manage extension and turn on "Allow in Incognito".',
    { id: INCOGNITO_NOT_ALLOWED_TOAST_ID }
  );
  return false;
}
