import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIREFOX_BETA, firefoxBetaXpiFileName } from '@tabmerger/shared';
import { FIREFOX_BETA_ADDON_ID } from './firefoxAddonIds';
import { buildUpdatesManifest, parseArgs, publishFirefoxBeta } from './publishFirefoxBeta';

describe('parseArgs', () => {
  it('parses xpiPath, version, webAppUrl in order', () => {
    expect(parseArgs(['/tmp/x.xpi', '4.1.0.3', 'https://tabmerger.vercel.app'])).toEqual({
      xpiPath: '/tmp/x.xpi',
      version: '4.1.0.3',
      webAppUrl: 'https://tabmerger.vercel.app',
    });
  });

  it('throws when any arg is missing', () => {
    expect(() => parseArgs([])).toThrow(/usage:/);
    expect(() => parseArgs(['/tmp/x.xpi'])).toThrow(/usage:/);
    expect(() => parseArgs(['/tmp/x.xpi', '4.1.0.3'])).toThrow(/usage:/);
  });
});

describe('buildUpdatesManifest', () => {
  it('shapes the AMO-style updates.json keyed by the beta add-on id', () => {
    const manifest = buildUpdatesManifest('3.1.0-beta.4', 'https://tabmerger.vercel.app');
    expect(manifest).toEqual({
      addons: {
        [FIREFOX_BETA_ADDON_ID]: {
          updates: [
            {
              version: '3.1.0-beta.4',
              update_link: `https://tabmerger.vercel.app${FIREFOX_BETA.PATH}/${firefoxBetaXpiFileName('3.1.0-beta.4')}`,
            },
          ],
        },
      },
    });
  });

  it('strips a trailing slash from webAppUrl so update_link never has a double slash', () => {
    const manifest = buildUpdatesManifest('3.1.0-beta.4', 'https://tabmerger.vercel.app/');
    const link = manifest.addons[FIREFOX_BETA_ADDON_ID].updates[0].update_link;
    expect(link).not.toMatch(/\.app\/\//);
    expect(link.startsWith('https://tabmerger.vercel.app/firefox-beta/')).toBe(true);
  });

  it('update_link is on our own domain, never a raw blob storage URL', () => {
    const manifest = buildUpdatesManifest('3.1.0-beta.4', 'https://tabmerger.vercel.app');
    const link = manifest.addons[FIREFOX_BETA_ADDON_ID].updates[0].update_link;
    expect(link).not.toContain('blob.vercel-storage.com');
  });
});

describe('publishFirefoxBeta', () => {
  let dir: string;
  let xpiPath: string;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'publish-firefox-beta-'));
    xpiPath = join(dir, 'signed.xpi');
    writeFileSync(xpiPath, 'fake-xpi-bytes');
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  it('throws clearly when BLOB_READ_WRITE_TOKEN is missing', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const putFn = vi.fn();
    await expect(
      publishFirefoxBeta(
        { xpiPath, version: '3.1.0-beta.4', webAppUrl: 'https://tabmerger.vercel.app' },
        { putFn },
      ),
    ).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
    expect(putFn).not.toHaveBeenCalled();
  });

  it('throws clearly when the xpi file does not exist', async () => {
    const putFn = vi.fn();
    await expect(
      publishFirefoxBeta(
        {
          xpiPath: join(dir, 'does-not-exist.xpi'),
          version: '3.1.0-beta.4',
          webAppUrl: 'https://tabmerger.vercel.app',
        },
        { putFn },
      ),
    ).rejects.toThrow(/not found/);
    expect(putFn).not.toHaveBeenCalled();
  });

  it('uploads in order: versioned xpi, latest xpi, updates.json — each with the right path/content-type', async () => {
    const calls: Array<{ pathname: string; contentType?: string; cacheControlMaxAge?: number }> = [];
    const putFn = vi.fn(async (pathname: string, _body: unknown, options: any) => {
      calls.push({
        pathname,
        contentType: options?.contentType,
        cacheControlMaxAge: options?.cacheControlMaxAge,
      });
      return { url: `https://example.public.blob.vercel-storage.com${pathname}` } as any;
    });

    await publishFirefoxBeta(
      { xpiPath, version: '3.1.0-beta.4', webAppUrl: 'https://tabmerger.vercel.app' },
      { putFn: putFn as any },
    );

    expect(calls).toHaveLength(3);

    const versionedName = firefoxBetaXpiFileName('3.1.0-beta.4');
    expect(calls[0].pathname).toBe(`${FIREFOX_BETA.PATH}/${versionedName}`);
    expect(calls[0].contentType).toBe(FIREFOX_BETA.XPI_CONTENT_TYPE);

    expect(calls[1].pathname).toBe(`${FIREFOX_BETA.PATH}/${FIREFOX_BETA.LATEST_XPI_FILE}`);
    expect(calls[1].contentType).toBe(FIREFOX_BETA.XPI_CONTENT_TYPE);
    expect(calls[1].cacheControlMaxAge).toBeGreaterThanOrEqual(60);

    expect(calls[2].pathname).toBe(`${FIREFOX_BETA.PATH}/${FIREFOX_BETA.UPDATES_FILE}`);
    expect(calls[2].contentType).toBe('application/json');
    expect(calls[2].cacheControlMaxAge).toBeGreaterThanOrEqual(60);
  });

  it('passes addRandomSuffix: false and allowOverwrite: true on every upload (fixed, overwritable paths)', async () => {
    const putFn = vi.fn(async (_pathname: string, _body: unknown, options: any) => {
      expect(options.addRandomSuffix).toBe(false);
      expect(options.allowOverwrite).toBe(true);
      expect(options.token).toBe('test-token');
      return { url: 'https://example.com' } as any;
    });

    await publishFirefoxBeta(
      { xpiPath, version: '3.1.0-beta.4', webAppUrl: 'https://tabmerger.vercel.app' },
      { putFn: putFn as any },
    );

    expect(putFn).toHaveBeenCalledTimes(3);
  });

  it('the updates.json body contains the exact update_link the manifest would produce', async () => {
    let updatesBody: string | undefined;
    const putFn = vi.fn(async (pathname: string, body: unknown, _options: any) => {
      if (pathname.endsWith(FIREFOX_BETA.UPDATES_FILE)) updatesBody = body as string;
      return { url: 'https://example.com' } as any;
    });

    await publishFirefoxBeta(
      { xpiPath, version: '3.1.0-beta.4', webAppUrl: 'https://tabmerger.vercel.app' },
      { putFn: putFn as any },
    );

    expect(updatesBody).toBeDefined();
    expect(JSON.parse(updatesBody!)).toEqual(
      buildUpdatesManifest('3.1.0-beta.4', 'https://tabmerger.vercel.app'),
    );
  });
});
