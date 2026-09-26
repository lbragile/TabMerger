import { describe, expect, it } from "vitest";
import { resolveManifestVersion } from "./manifestVersion";

/** Numeric compare of two dot-separated manifest version strings, left-to-right. */
function compareManifestVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

describe("resolveManifestVersion", () => {
  it("passes a stable version through unchanged with no version_name", () => {
    expect(resolveManifestVersion("2.2.0")).toEqual({ version: "2.2.0" });
  });

  it("handles a stable major version bump", () => {
    expect(resolveManifestVersion("3.0.0")).toEqual({ version: "3.0.0" });
  });

  it("handles a stable version unrelated to the beta offset", () => {
    expect(resolveManifestVersion("3.1.0")).toEqual({ version: "3.1.0" });
  });

  it("offsets a beta prerelease's major by BETA_STORE_MAJOR_OFFSET and maps N onto the 4th integer", () => {
    expect(resolveManifestVersion("3.1.0-beta.4")).toEqual({
      version: "4.1.0.4",
      version_name: "3.1.0-beta.4",
    });
  });

  it("keeps the offset beta version above the accidentally-published 4.0.0.1", () => {
    const { version } = resolveManifestVersion("3.1.0-beta.4");
    expect(compareManifestVersions(version, "4.0.0.1")).toBeGreaterThan(0);
  });

  it("preserves release ordering across the beta offset as the release line progresses", () => {
    const versions = [
      resolveManifestVersion("3.1.0-beta.4").version,
      resolveManifestVersion("3.1.0-beta.5").version,
      resolveManifestVersion("3.2.0-beta.1").version,
      resolveManifestVersion("4.0.0-beta.1").version,
    ];

    for (let i = 0; i < versions.length - 1; i++) {
      expect(compareManifestVersions(versions[i], versions[i + 1])).toBeLessThan(0);
    }
  });

  it("handles beta.1 (first prerelease of a cycle)", () => {
    expect(resolveManifestVersion("2.2.0-beta.1")).toEqual({
      version: "3.2.0.1",
      version_name: "2.2.0-beta.1",
    });
  });

  it("handles multi-digit beta counters", () => {
    expect(resolveManifestVersion("2.2.0-beta.42")).toEqual({
      version: "3.2.0.42",
      version_name: "2.2.0-beta.42",
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveManifestVersion("  2.2.0-beta.3  ")).toEqual({
      version: "3.2.0.3",
      version_name: "2.2.0-beta.3",
    });
  });

  it("throws on an unsupported prerelease tag (only 'beta' is a recognized channel)", () => {
    expect(() => resolveManifestVersion("2.2.0-alpha.1")).toThrow(
      /not a supported version string/,
    );
  });

  it("throws on a v-prefixed tag (must be pre-stripped by the caller)", () => {
    expect(() => resolveManifestVersion("v2.2.0")).toThrow(/not a supported version string/);
  });

  it("throws on a two-part version", () => {
    expect(() => resolveManifestVersion("2.2")).toThrow(/not a supported version string/);
  });

  it("throws on a beta suffix missing its counter", () => {
    expect(() => resolveManifestVersion("2.2.0-beta")).toThrow(/not a supported version string/);
  });

  it("throws on an empty string", () => {
    expect(() => resolveManifestVersion("")).toThrow(/not a supported version string/);
  });

  it("throws when a manifest version component would exceed Chrome's 65535 cap", () => {
    expect(() => resolveManifestVersion("65535.0.0-beta.1")).toThrow(
      /exceeding Chrome's limit of 65535/,
    );
  });

  it("throws when a stable version component would exceed Chrome's 65535 cap", () => {
    expect(() => resolveManifestVersion("65536.0.0")).toThrow(
      /exceeding Chrome's limit of 65535/,
    );
  });
});
