import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    trace: 'off',
    video: 'off',
  },
  // Traces/HAR are disabled so auth payloads and headers are not recorded.
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/login',
    reuseExistingServer: !process.env.CI,
    env: { VITE_AUTH_MOCK: 'true' },
  },
})
