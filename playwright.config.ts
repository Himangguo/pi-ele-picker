import { defineConfig } from '@playwright/test';

/** Must match the `server.port` in test/fixture/vite.config.ts. */
const PORT = 5273;

/**
 * Local runs reuse the Chrome that is already installed, which avoids a ~150MB
 * browser download on every fresh checkout. CI has no such shortcut, so it
 * installs Playwright's pinned Chromium (`npx playwright install chromium`) and
 * runs with that instead — set PW_BUNDLED=1 to do the same locally.
 */
const useBundledChromium = !!process.env.CI || process.env.PW_BUNDLED === '1';

export default defineConfig({
  testDir: './test',
  testMatch: /.*\.spec\.ts$/,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 30_000,

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: useBundledChromium ? undefined : ('chrome' as const),
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },

  webServer: {
    command: 'vite --config test/fixture/vite.config.ts',
    url: `http://127.0.0.1:${PORT}/__pi_picker__/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    // `POST /__pi_picker__/open` spawns launch-editor. Use a harmless command so
    // the endpoint can be tested end to end without opening an editor in CI.
    env: { LAUNCH_EDITOR: 'echo' },
  },
});
