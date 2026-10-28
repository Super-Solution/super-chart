import { defineConfig } from '@playwright/test'

/**
 * Browser behaviour tests over the BUILT package (run `bun run build` in
 * frontend/super-chart first). One project per klinecharts version a host
 * runs: 9.7.2 (Broker's pin) and 9.8.12 (SupWallet, ProjectX), plus a
 * lifecycle-only leg on 9.1.1 (below).
 *
 * Browser: the installed Google Chrome (`channel: 'chrome'`). Nothing is
 * downloaded: install with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 and never run
 * `playwright install`.
 */
const port = Number(process.env.SC_E2E_PORT ?? 4179)
// SC_E2E_EXTRA_KC=<version> adds a project for another klinecharts version,
// read from e2e/node_modules/kc-<version with dashes> (put it there yourself;
// it is not a dependency). For one-off checks of versions outside the peer range.
const extra = process.env.SC_E2E_EXTRA_KC

export default defineConfig({
  testDir: './tests',
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
  projects: [
    { name: 'kc-9.7.2', use: { kc: '9.7.2' } as never },
    { name: 'kc-9.8.12', use: { kc: '9.8.12' } as never },
    // Outside the peer range, and only the lifecycle spec: SC-005. klinecharts
    // 9.1.1 throws when dispose() is given the chart's element instead of the
    // Chart, and leaves the chart's DOM behind; 9.7+ accept either, so this is
    // the only leg on which that regression turns red.
    { name: 'kc-9.1.1', use: { kc: '9.1.1' } as never, testMatch: 'lifecycle.spec.ts' },
    ...(extra !== undefined && extra !== '' ? [{ name: `kc-${extra}`, use: { kc: extra } as never }] : [])
  ]
})
