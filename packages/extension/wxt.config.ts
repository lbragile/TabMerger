import { defineConfig } from 'wxt';
import path from 'path';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
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
    permissions: ['tabs', 'storage', 'alarms', 'contextMenus', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_popup: 'popup.html' },
    browser_specific_settings: {
      gecko: { id: 'tabmerger@lbragile.com', strict_min_version: '109.0' }
    }
  },
  dev: {
    server: { port: 3001 }
  },
  runner: {
    chromiumArgs: ['--user-data-dir=.wxt/chrome-data']
  }
});
