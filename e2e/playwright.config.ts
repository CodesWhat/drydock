import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.DD_PLAYWRIGHT_BASE_URL || 'http://localhost:3333';

export default defineConfig({
  testDir: './playwright',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: isCI ? [['html', { outputFolder: 'playwright-report', open: 'never' }]] : [['list']],

  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      testIgnore: /login\.spec\.ts/,
      use: {
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'login',
      testMatch: /login\.spec\.ts/,
      use: {
        storageState: { cookies: [], origins: [] },
      },
    },
  ],
});
