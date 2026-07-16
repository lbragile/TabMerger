import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../.output/chrome-mv3');

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    // ponytail: headless: false required — Chrome extensions can't load headlessly
    headless: false,
    viewport: { width: 800, height: 600 },
    launchOptions: {
      args: [
        `--load-extension=${EXTENSION_PATH}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
      ],
    },
  },
  // Single worker: extension ID is global state shared across tests
  workers: 1,
});
