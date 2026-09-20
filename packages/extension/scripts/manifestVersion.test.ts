import { describe, expect, it } from "vitest";
import { resolveManifestVersion } from "./manifestVersion";

describe("resolveManifestVersion", () => {
  it("passes a stable version through unchanged with no version_name", () => {
    expect(resolveManifestVersion("2.2.0")).toEqual({ version: "2.2.0" });
  });

  it("maps a beta prerelease's N onto the 4th manifest integer", () => {
    expect(resolveManifestVersion("2.2.0-beta.3")).toEqual({
      version: "2.2.0.3",
      version_name: "2.2.0-beta.3",
    });
  });

  it("handles beta.1 (first prerelease of a cycle)", () => {
    expect(resolveManifestVersion("2.2.0-beta.1")).toEqual({
      version: "2.2.0.1",
      version_name: "2.2.0-beta.1",
    });
  });

  it("handles multi-digit beta counters", () => {
    expect(resolveManifestVersion("2.2.0-beta.42")).toEqual({
      version: "2.2.0.42",
      version_name: "2.2.0-beta.42",
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(resolveManifestVersion("  2.2.0-beta.3  ")).toEqual({
      version: "2.2.0.3",
      version_name: "2.2.0-beta.3",
    });
  });

  it("handles a stable major version bump", () => {
    expect(resolveManifestVersion("3.0.0")).toEqual({ version: "3.0.0" });
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
});
