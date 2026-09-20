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
 * Mapping:
 *   "2.2.0"          -> { version: "2.2.0" }                                (stable, unchanged)
 *   "2.2.0-beta.3"    -> { version: "2.2.0.3", version_name: "2.2.0-beta.3" } (beta N becomes the 4th integer)
 *
 * See release-and-beta-channel-spec.md §3.4.
 */

const SEMVER_WITH_OPTIONAL_BETA_RE = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

export interface ManifestVersionFields {
  /** Always 1-4 dot-separated integers — valid MV3 `manifest.version`. */
  version: string;
  /**
   * Only present for prereleases. The original semver string (including the
   * `-beta.N` suffix), shown to users in place of the numeric `version`.
   */
  version_name?: string;
}

/**
 * @param rawVersion A semantic-release version string: "X.Y.Z" (stable) or
 *   "X.Y.Z-beta.N" (prerelease, per `.releaserc.json`'s `beta` branch config).
 * @throws if `rawVersion` doesn't match either shape — a silently-wrong
 *   manifest version reaching the store is worse than a build that fails loudly.
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
    return { version: `${major}.${minor}.${patch}` };
  }

  return {
    version: `${major}.${minor}.${patch}.${betaN}`,
    version_name: rawVersion.trim(),
  };
}
