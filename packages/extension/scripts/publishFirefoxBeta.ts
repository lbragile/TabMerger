/**
 * Uploads a signed Firefox BETA .xpi (unlisted, self-distributed) to Vercel Blob and
 * (re)writes the AMO-style `updates.json` manifest Firefox polls via
 * `gecko.update_url` (wired onto beta builds by wxt.config.ts, pointing at
 * `<VITE_WEB_APP_URL>${FIREFOX_BETA.PATH}/${FIREFOX_BETA.UPDATES_FILE}`).
 *
 * The web app rewrites `${FIREFOX_BETA.PATH}/*` on its own domain through to this
 * Blob store, so every URL a client ever sees is on our domain — never a raw
 * `*.public.blob.vercel-storage.com` URL. See `FIREFOX_BETA` in
 * `@tabmerger/shared` for the shared path/file-name contract; never re-type these
 * names here.
 *
 * Upload order is load-bearing:
 *   1. the versioned .xpi (so a client mid-download of a stale updates.json can
 *      still fetch the exact version it was told about)
 *   2. the same bytes again under the stable LATEST_XPI_FILE name (what the
 *      /beta page's "download" link points at)
 *   3. updates.json LAST — only once both .xpi objects exist does the manifest
 *      start advertising the new version, so Firefox's auto-update check can
 *      never race ahead of the file it's about to request.
 *
 * Usage:
 *   tsx scripts/publishFirefoxBeta.ts <path-to-signed.xpi> <version> <webAppUrl>
 *
 * Requires BLOB_READ_WRITE_TOKEN in the environment (CI: secrets.FIREFOX_BETA_BLOB_TOKEN).
 */

import { readFileSync, existsSync } from 'node:fs';
import { put } from '@vercel/blob';
import { FIREFOX_BETA, firefoxBetaXpiFileName } from '@tabmerger/shared';
import { FIREFOX_BETA_ADDON_ID } from './firefoxAddonIds';

/** Vercel Blob will not accept an object below this cache lifetime. */
const MIN_CACHE_CONTROL_MAX_AGE_SECONDS = 60;

interface UpdatesManifest {
  addons: {
    [addonId: string]: {
      updates: Array<{ version: string; update_link: string }>;
    };
  };
}

/**
 * @param webAppUrl e.g. "https://tabmerger.vercel.app" — no trailing slash expected,
 *   but one is tolerated (stripped) so a copy-pasted secret with a trailing `/`
 *   doesn't produce a double slash in `update_link`.
 */
export function buildUpdatesManifest(version: string, webAppUrl: string): UpdatesManifest {
  const base = webAppUrl.replace(/\/+$/, '');
  return {
    addons: {
      [FIREFOX_BETA_ADDON_ID]: {
        updates: [
          {
            version,
            update_link: `${base}${FIREFOX_BETA.PATH}/${firefoxBetaXpiFileName(version)}`,
          },
        ],
      },
    },
  };
}

export interface PublishFirefoxBetaArgs {
  xpiPath: string;
  version: string;
  webAppUrl: string;
}

/** Parses and validates argv (excluding node/script path) into typed args, or throws. */
export function parseArgs(argv: readonly string[]): PublishFirefoxBetaArgs {
  const [xpiPath, version, webAppUrl] = argv;
  if (!xpiPath || !version || !webAppUrl) {
    throw new Error(
      'publishFirefoxBeta: usage: tsx scripts/publishFirefoxBeta.ts <signed.xpi> <version> <webAppUrl>',
    );
  }
  return { xpiPath, version, webAppUrl };
}

/** Minimal shape of the subset of the `put` API this script depends on — lets tests inject a mock without pulling in the real SDK's types. */
export type BlobPut = typeof put;

export async function publishFirefoxBeta(
  args: PublishFirefoxBetaArgs,
  { putFn = put }: { putFn?: BlobPut } = {},
): Promise<void> {
  const { xpiPath, version, webAppUrl } = args;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      'publishFirefoxBeta: BLOB_READ_WRITE_TOKEN is not set (CI: secrets.FIREFOX_BETA_BLOB_TOKEN).',
    );
  }

  if (!existsSync(xpiPath)) {
    throw new Error(`publishFirefoxBeta: signed .xpi not found at "${xpiPath}"`);
  }

  const xpiBytes = readFileSync(xpiPath);
  const versionedFileName = firefoxBetaXpiFileName(version);

  // 1. Versioned .xpi — permanent, immutable per version, so it can cache "forever"-ish.
  await putFn(`${FIREFOX_BETA.PATH}/${versionedFileName}`, xpiBytes, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: FIREFOX_BETA.XPI_CONTENT_TYPE,
    token,
  });

  // 2. Same bytes under the stable "latest" name — this DOES change every release,
  // so keep its cache lifetime short (the Blob-enforced minimum).
  await putFn(`${FIREFOX_BETA.PATH}/${FIREFOX_BETA.LATEST_XPI_FILE}`, xpiBytes, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: FIREFOX_BETA.XPI_CONTENT_TYPE,
    cacheControlMaxAge: MIN_CACHE_CONTROL_MAX_AGE_SECONDS,
    token,
  });

  // 3. updates.json LAST — see the module doc for why ordering matters here.
  const manifest = buildUpdatesManifest(version, webAppUrl);
  await putFn(`${FIREFOX_BETA.PATH}/${FIREFOX_BETA.UPDATES_FILE}`, JSON.stringify(manifest), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: MIN_CACHE_CONTROL_MAX_AGE_SECONDS,
    token,
  });

  console.log(
    `publishFirefoxBeta: published ${versionedFileName} (+ ${FIREFOX_BETA.LATEST_XPI_FILE}, ${FIREFOX_BETA.UPDATES_FILE}) for version ${version}.`,
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    await publishFirefoxBeta(args);
  } catch (err) {
    console.error(`::error::${(err as Error).message}`);
    process.exit(1);
  }
}
