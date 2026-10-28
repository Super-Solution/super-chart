import { test as base, expect, type Page } from '@playwright/test'

/** The klinecharts version of the current project (see playwright.config.ts). */
export const test = base.extend<{ kc: string }>({
  kc: ['9.8.12', { option: true }]
})
export { expect }

/** Open the harness with this project's klinecharts and wait for window.H. */
export async function openHarness (page: Page, kc: string, build: 'esm' | 'umd' = 'esm'): Promise<void> {
  const consoleErrors: string[] = []
  const requestErrors: string[] = []
  page.on('pageerror', e => { if (consoleErrors.length < 10) consoleErrors.push(String(e).slice(0, 500)) })
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (requestErrors.length < 10 && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      requestErrors.push(`${url.pathname}: ${request.failure()?.errorText ?? 'request failed'}`)
    }
  })
  await page.goto(`/e2e/pages/harness.html?kc=${kc}&build=${build}`)
  try {
    await page.waitForFunction(() => (window as any).__ready === true, undefined, { timeout: 30_000 })
  } catch (cause) {
    // Keep the original failure and bound: never retry a broken module into green.
    const errors = await page.evaluate(() => ((window as any).__errors ?? []).slice(0, 10)).catch(() => [])
    throw Object.assign(new Error(`Harness initialization failed (${kc}/${build}); page=${JSON.stringify(consoleErrors)}; harness=${JSON.stringify(errors)}; requests=${JSON.stringify(requestErrors)}`), { cause })
  }
  const loaded = await page.evaluate(() => (window as any).H.kcVersion)
  expect(loaded, 'the harness loaded the klinecharts version this project is for').toBe(kc)
}

/** Uncaught errors and unhandled rejections the page has seen so far. */
export async function pageErrors (page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as any).__errors as string[])
}
