#!/usr/bin/env node
// Fails CI when the built Chrome manifest's permission surface differs from the committed
// baseline (packages/extension/manifest-permissions.json).
//
// Why: a new permission, host permission or content-script match widens what users are
// warned about at install, and can move the extension into a slower store review tier
// (this manifest deliberately has no host_permissions). It must be a deliberate change,
// never a side effect of an edit or a dependency bump.
//
// Usage (after `pnpm --filter @tabmerger/extension build`):
//   node scripts/ci/check-manifest-permissions.mjs            # compare, exit 1 on any diff
//   node scripts/ci/check-manifest-permissions.mjs --update   # rewrite the baseline
//
// When it fails on purpose: run with --update, commit the baseline, and in the same change
// give the new permission a plain-English justification in packages/extension/CHROMEWEBSTORE.md.
//
// `externally_connectable` is intentionally not compared: it is derived from build-time env
// (VITE_WEB_APP_URL, extension IDs) and differs per environment.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MANIFEST_PATH = "packages/extension/.output/chrome-mv3/manifest.json";
const BASELINE_PATH = "packages/extension/manifest-permissions.json";

const PLAIN_KEYS = [
    "permissions",
    "optional_permissions",
    "host_permissions",
    "optional_host_permissions",
];

const sorted = (list) => [...new Set(list ?? [])].sort();

/** Reduces a manifest to the fields that define what the extension may touch. */
export function permissionSurface(manifest) {
    const surface = {};
    for (const key of PLAIN_KEYS) surface[key] = sorted(manifest[key]);
    surface.content_script_matches = sorted(
        (manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
    );
    surface.web_accessible_matches = sorted(
        (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.matches ?? []),
    );
    return surface;
}

/** Returns one human-readable line per added or removed entry. */
export function diffSurface(baseline, current) {
    const lines = [];
    for (const key of Object.keys(current)) {
        const before = new Set(baseline[key] ?? []);
        const after = new Set(current[key]);
        for (const value of after) if (!before.has(value)) lines.push(`+ ${key}: ${value}`);
        for (const value of before) if (!after.has(value)) lines.push(`- ${key}: ${value}`);
    }
    return lines;
}

function main() {
    let manifest;
    try {
        manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    } catch {
        console.error(`::error::Cannot read ${MANIFEST_PATH}. Build the extension first.`);
        process.exit(2);
    }
    const current = permissionSurface(manifest);

    if (process.argv.includes("--update")) {
        writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 4)}\n`);
        console.log(`Wrote ${BASELINE_PATH}`);
        return;
    }

    let baseline;
    try {
        baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    } catch {
        console.error(`::error::Cannot read ${BASELINE_PATH}. Create it with --update.`);
        process.exit(2);
    }

    const diff = diffSurface(baseline, current);
    if (diff.length === 0) {
        console.log("Manifest permissions match the baseline.");
        return;
    }
    console.error(diff.join("\n"));
    console.error(
        "::error::The built manifest's permissions changed. If this is intended, run " +
            "`node scripts/ci/check-manifest-permissions.mjs --update`, commit " +
            `${BASELINE_PATH}, and add the justification to packages/extension/CHROMEWEBSTORE.md.`,
    );
    process.exit(1);
}

// Run only when executed directly, so the helpers can be imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
