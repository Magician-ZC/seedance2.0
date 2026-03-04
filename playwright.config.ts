import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://0.0.0.0:5173',
    headless: true,
  },
  webServer: {
    command: 'npm run dev:client',
    port: 5173,
    reuseExistingServer: true,
  },
});
