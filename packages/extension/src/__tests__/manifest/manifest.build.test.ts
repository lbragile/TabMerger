import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { FIREFOX_BETA_ADDON_ID, FIREFOX_STABLE_ADDON_ID } from "../../../scripts/firefoxAddonIds";

/**
 * Build-output checks on the emitted manifest.json, run with `pnpm test:manifest` (not part of
 * the unit suite: each case is a real `wxt build`).
 *
 * - The Firefox-only web-bridge content script (web-bridge.content.ts, `include: ['firefox']`)
 *   must never reach the Chromium manifests (no content_scripts, no new host permission), while
 *   the Firefox manifest carries exactly this one script, scoped to the build's web app origin.
 * - The Firefox add-on ID must be the live AMO listing's GUID for stable, and the separate beta
 *   ID for beta: any other stable ID is a different add-on, so existing users would stop updating.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
// .../src/__tests__/manifest -> .../packages/extension
const extensionRoot = path.resolve(testDir, "../../../");

type Manifest = {
  content_scripts?: { matches: string[]; js: string[] }[];
  host_permissions?: string[];
  browser_specific_settings?: { gecko?: { id?: string } };
};

function build(args: string[], outDirName: string): Manifest {
  // shell: true is required for npx.cmd to resolve on Windows; every arg here is a fixed
  // literal (never derived from external/user input), so shell-arg injection isn't a concern.
  execFileSync("npx", ["wxt", "build", ...args], { cwd: extensionRoot, stdio: "pipe", shell: true });
  const manifestPath = path.join(extensionRoot, ".output", outDirName, "manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

describe("manifest build output", () => {
  it("Chrome manifest has no content_scripts and no new host permission", () => {
    const manifest = build([], "chrome-mv3");
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("Edge manifest has no content_scripts either", () => {
    const manifest = build(["-b", "edge"], "edge-mv3");
    expect(manifest.content_scripts).toBeUndefined();
  });

  it("Firefox stable: one web-bridge content script on the web app origin, and the live add-on ID", () => {
    const manifest = build(["-b", "firefox"], "firefox-mv3");
    expect(manifest.content_scripts).toHaveLength(1);
    const entry = manifest.content_scripts![0];
    expect(entry.js).toEqual(["content-scripts/web-bridge.js"]);
    expect(entry.matches).toHaveLength(1);
    expect(entry.matches[0]).toMatch(/^https?:\/\/.+\/\*$/);
    expect(manifest.browser_specific_settings?.gecko?.id).toBe(FIREFOX_STABLE_ADDON_ID);
  });

  it("Firefox beta uses its own add-on ID", () => {
    const manifest = build(["-b", "firefox", "--mode", "beta"], "firefox-mv3-beta");
    expect(manifest.browser_specific_settings?.gecko?.id).toBe(FIREFOX_BETA_ADDON_ID);
    expect(FIREFOX_BETA_ADDON_ID).not.toBe(FIREFOX_STABLE_ADDON_ID);
  });
});
