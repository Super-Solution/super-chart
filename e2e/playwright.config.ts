import { defineConfig } from '@playwright/test'

/**
 * Existing browser behaviour cases over the built owned package. There is
 * one engine, so hosts no longer repeat the suite across upstream versions.
 *
 * Browser: the installed Google Chrome (`channel: 'chrome'`). Nothing is
 * downloaded: install with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 and never run
 * `playwright install`.
 */
const port = Number(process.env.SC_E2E_PORT ?? 4179)

export default defineConfig({
  testDir: './tests',
  // The retained legacy files describe removed Pro/upstream interfaces.
  // See MIGRATION.md for the per-feature accounting; they are not green checks.
  testMatch: [
    'analysis-overlays.spec.ts', 'api-core.spec.ts', 'chart-interaction.spec.ts',
    'commands.spec.ts', 'drawing-editor.spec.ts', 'drawing-input.spec.ts',
    'indicators.spec.ts', 'interaction.spec.ts', 'lifecycle.spec.ts',
    'loader.spec.ts', 'motion.spec.ts', 'smoke.spec.ts', 'superscript.spec.ts'
  ],
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 800 }
  },
  webServer: {
    command: 'node server.mjs',
    url: `http://127.0.0.1:${port}/e2e/pages/harness.html`,
    reuseExistingServer: false,
    env: { SC_E2E_PORT: String(port) }
  },
  projects: [{ name: 'owned' }]
})
