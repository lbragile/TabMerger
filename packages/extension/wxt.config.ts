import { defineConfig } from 'wxt';
import path from 'path';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'], // HMR enabled by default — popup React components hot-reload via Fast Refresh; background/content scripts auto-reload on save
  vite: () => ({
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    }
  }),
  manifest: {
    name: 'TabMerger',
    description: 'Merge and organize browser tabs into groups to reduce memory usage',
    permissions: ['tabs', 'tabGroups', 'storage', 'alarms', 'contextMenus', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_popup: 'popup.html' },
    web_accessible_resources: [
      { resources: ['images/*'], matches: ['<all_urls>'] }
    ],
    browser_specific_settings: {
      gecko: { id: 'tabmerger@lbragile.com', strict_min_version: '109.0' }
    }
  },
  dev: {
    server: { port: 3001 }
  },
  runner: {
    // Isolated profile so the dev extension doesn't pollute a real Chrome profile.
    // --no-first-run prevents Chrome's welcome page from opening on a fresh profile.
    chromiumArgs: ['--user-data-dir=.wxt/chrome-data', '--no-first-run'],
    // Explicitly open about:blank; omitting this (or passing []) lets startUrl be
    // undefined, which causes Chrome to fall back to its default welcome page.
    startUrls: ['about:blank'],
  }
});
