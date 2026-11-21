// Re-captures the blog post's screenshots: Chrome/Edge settings pages (native.mjs), the TabMerger
// popup in light and dark (tm/blogShots.spec.ts), then crops and converts everything to WebP
// (convert.mjs). Paths are worked out from this file's place in the repo; nothing is hard-coded.
//
//   node scripts/blog-screenshots/run.mjs [raw-dir] [out-dir]
//
// raw-dir defaults to scripts/blog-screenshots/.raw (git-ignored PNGs), out-dir to
// packages/web/public/blog/save-all-open-tabs. Needs the production extension build
// (`pnpm build:extension`, packages/extension/.output/chrome-mv3) and Chrome + Edge installed.
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RAW = path.resolve(process.argv[2] ?? path.join(HERE, '.raw'));
const OUT = path.resolve(process.argv[3] ?? path.join(REPO, 'packages', 'web', 'public', 'blog', 'save-all-open-tabs'));
const shell = process.platform === 'win32';

execFileSync(process.execPath, [path.join(HERE, 'native.mjs'), RAW], { stdio: 'inherit' });
for (const theme of ['light', 'dark']) {
  execFileSync(
    'pnpm',
    ['--filter', '@tabmerger/extension', 'exec', 'playwright', 'test', '-c', path.join(HERE, 'tm', 'playwright.config.mjs')],
    { stdio: 'inherit', shell, env: { ...process.env, BLOG_OUT: RAW, BLOG_THEME: theme } }
  );
}
execFileSync(process.execPath, [path.join(HERE, 'convert.mjs'), RAW, OUT], { stdio: 'inherit' });
