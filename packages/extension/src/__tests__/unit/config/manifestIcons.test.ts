import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Regression guard for a broken build: commit ea8b0d5 deleted the old logo PNGs
 * and they were never re-added at the new `src/public/` path, so every manifest
 * icon declared in `wxt.config.ts` (and `@/assets/logo.png` imported by
 * `src/components/Header/index.tsx`) pointed at a non-existent file and the
 * extension failed to build/load.
 *
 * These assertions are pure filesystem checks — no WXT/Vite build needed.
 */

const testDir = path.dirname(fileURLToPath(import.meta.url));
// .../src/__tests__/unit/config -> .../packages/extension
const extensionRoot = path.resolve(testDir, "../../../../");
const wxtConfigPath = path.join(extensionRoot, "wxt.config.ts");
// WXT's `publicDir` is "src/public" (see wxt.config.ts) — manifest icon paths
// like "/icon/16.png" resolve relative to that directory.
const publicDir = path.join(extensionRoot, "src", "public");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // \x89PNG

function assertValidPng(filePath: string) {
    expect(existsSync(filePath), `${filePath} should exist on disk`).toBe(true);
    const buf = readFileSync(filePath);
    expect(buf.byteLength, `${filePath} should be non-empty`).toBeGreaterThan(0);
    expect(
        buf.subarray(0, 4).equals(PNG_MAGIC),
        `${filePath} should start with the PNG magic bytes`,
    ).toBe(true);
}

/**
 * Pull the icon path strings out of the `icons: { ... }` block in wxt.config.ts.
 * Falls back to nothing if the block can't be found (covered by a separate assertion).
 */
function readDeclaredIconPaths(): string[] {
    const src = readFileSync(wxtConfigPath, "utf8");
    const block = src.match(/icons:\s*\{([^}]*)\}/);
    if (!block) return [];
    return [...block[1].matchAll(/["']([^"']+\.png)["']/g)].map((m) => m[1]);
}

describe("manifest icon assets", () => {
    const declared = readDeclaredIconPaths();

    it("wxt.config.ts declares the expected five icon sizes", () => {
        // Hardcoded expectation mirrors the `icons` map in wxt.config.ts.
        expect(declared.sort()).toEqual(
            [
                "/icon/16.png",
                "/icon/32.png",
                "/icon/48.png",
                "/icon/96.png",
                "/icon/128.png",
            ].sort(),
        );
    });

    it.each(
        (declared.length
            ? declared
            : ["/icon/16.png", "/icon/32.png", "/icon/48.png", "/icon/96.png", "/icon/128.png"]
        ).map((p) => [p] as const),
    )("icon %s referenced by the manifest exists and is a valid PNG", (iconPath) => {
        const onDisk = path.join(publicDir, iconPath.replace(/^\//, ""));
        assertValidPng(onDisk);
    });
});

describe("Header logo asset", () => {
    it("src/assets/logo.png exists and is a valid PNG (imported as @/assets/logo.png)", () => {
        assertValidPng(path.join(extensionRoot, "src", "assets", "logo.png"));
    });
});
