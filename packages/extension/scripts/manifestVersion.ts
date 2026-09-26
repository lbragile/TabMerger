/**
 * Maps a semantic-release version string onto the two fields Chrome's MV3
 * manifest needs.
 *
 * Chrome's `manifest.version` field accepts ONLY 1-4 dot-separated
 * non-negative integers — no prerelease suffix, no letters. A beta build's
 * version from semantic-release (e.g. "2.2.0-beta.3") is not valid syntax
 * there and Chrome rejects the upload outright.
 *
 * `version_name` has no such restriction — it's the free-form string shown
 * to users in chrome://extensions and the Web Store listing — so the
 * prerelease identifier moves there instead of being dropped.
 *
 * On 2026-09-26, an erroneous `4.0.0-beta.1` release accidentally published
 * manifest version `4.0.0.1` to the BETA Chrome Web Store item. The Web
 * Store only accepts uploads with a strictly HIGHER `manifest.version` than
 * whatever is currently published — forever, even after the release line is
 * reverted. To keep every future beta build uploadable, the BETA channel's
 * mapped major version is offset by `BETA_STORE_MAJOR_OFFSET` (currently
 * `1`), so the numeric version stays permanently ahead of `4.0.0.1` and
 * still sorts in semver order release-to-release. Users never see this —
 * they only see the true semver string in `version_name`. Do not remove or
 * reduce this offset; doing so would make beta manifest versions go
 * backwards relative to what's already live on the store.
 *
 * Mapping:
 *   "2.2.0"          -> { version: "2.2.0" }                                   (stable, unchanged)
 *   "3.1.0-beta.4"    -> { version: "4.1.0.4", version_name: "3.1.0-beta.4" }    (beta major +1, N becomes the 4th integer)
 *   "3.1.0-beta.5"    -> { version: "4.1.0.5", version_name: "3.1.0-beta.5" }
 *   "3.2.0-beta.1"    -> { version: "4.2.0.1", version_name: "3.2.0-beta.1" }
 *   "4.0.0-beta.1"    -> { version: "5.0.0.1", version_name: "4.0.0-beta.1" }
 *
 * See release-and-beta-channel-spec.md §3.4.
 */

const SEMVER_WITH_OPTIONAL_BETA_RE = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

/**
 * Chrome's Web Store rejected `4.0.0-beta.1` on 2026-09-26, permanently
 * publishing manifest version `4.0.0.1` on the BETA item. Since the store
 * only ever accepts a strictly increasing `manifest.version`, every future
 * beta build's mapped major is offset by this amount so it stays above
 * `4.0.0.1` while the release line reverts to `3.1.0-beta.4` and beyond.
 * Never decrease this — it would make beta uploads go backwards.
 */
export const BETA_STORE_MAJOR_OFFSET = 1;

/** Chrome caps each `manifest.version` dot-separated component at this value. */
const MAX_MANIFEST_VERSION_COMPONENT = 65535;

export interface ManifestVersionFields {
  /** Always 1-4 dot-separated integers — valid MV3 `manifest.version`. */
  version: string;
  /**
   * Only present for prereleases. The original semver string (including the
   * `-beta.N` suffix), shown to users in place of the numeric `version`.
   */
  version_name?: string;
}

function assertWithinManifestBounds(components: number[], rawVersion: string): void {
  for (const component of components) {
    if (component > MAX_MANIFEST_VERSION_COMPONENT) {
      throw new Error(
        `resolveManifestVersion: "${rawVersion}" produced a manifest version component ` +
          `(${component}) exceeding Chrome's limit of ${MAX_MANIFEST_VERSION_COMPONENT}`,
      );
    }
  }
}

/**
 * @param rawVersion A semantic-release version string: "X.Y.Z" (stable) or
 *   "X.Y.Z-beta.N" (prerelease, per `.releaserc.json`'s `beta` branch config).
 * @throws if `rawVersion` doesn't match either shape — a silently-wrong
 *   manifest version reaching the store is worse than a build that fails loudly.
 * @throws if any resulting manifest version component exceeds Chrome's
 *   65535-per-component limit.
 */
export function resolveManifestVersion(rawVersion: string): ManifestVersionFields {
  const match = SEMVER_WITH_OPTIONAL_BETA_RE.exec(rawVersion.trim());

  if (!match) {
    throw new Error(
      `resolveManifestVersion: "${rawVersion}" is not a supported version string ` +
        `(expected "X.Y.Z" or "X.Y.Z-beta.N")`,
    );
  }

  const [, major, minor, patch, betaN] = match;

  if (betaN === undefined) {
    const stableComponents = [Number(major), Number(minor), Number(patch)];
    assertWithinManifestBounds(stableComponents, rawVersion);
    return { version: `${major}.${minor}.${patch}` };
  }

  const offsetMajor = Number(major) + BETA_STORE_MAJOR_OFFSET;
  const betaComponents = [offsetMajor, Number(minor), Number(patch), Number(betaN)];
  assertWithinManifestBounds(betaComponents, rawVersion);

  return {
    version: `${offsetMajor}.${minor}.${patch}.${betaN}`,
    version_name: rawVersion.trim(),
  };
}
