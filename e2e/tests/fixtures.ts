import { test as base, expect, type Page } from '@playwright/test'

export const test = base
export { expect }

/** Open the built owned-engine harness and wait for window.H. */
export async function openHarness (page: Page, build: 'esm' | 'umd' = 'esm'): Promise<void> {
  const consoleErrors: string[] = []
  const requestErrors: string[] = []
  page.on('pageerror', e => { if (consoleErrors.length < 10) consoleErrors.push(String(e).slice(0, 500)) })
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (requestErrors.length < 10 && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      requestErrors.push(`${url.pathname}: ${request.failure()?.errorText ?? 'request failed'}`)
    }
  })
  await page.goto(`/e2e/pages/harness.html?build=${build}`)
  try {
    await page.waitForFunction(() => (window as any).__ready === true, undefined, { timeout: 30_000 })
  } catch (cause) {
    // Keep the original failure and bound: never retry a broken module into green.
    const errors = await page.evaluate(() => ((window as any).__errors ?? []).slice(0, 10)).catch(() => [])
    throw Object.assign(new Error(`Harness initialization failed (${build}); page=${JSON.stringify(consoleErrors)}; harness=${JSON.stringify(errors)}; requests=${JSON.stringify(requestErrors)}`), { cause })
  }
}

/** Uncaught errors and unhandled rejections the page has seen so far. */
export async function pageErrors (page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as any).__errors as string[])
}

/** Arm a drawing tool through the workspace's own rail: open its group's flyout and choose the tool. */
export async function pickTool (page: Page, scope: string, type: string): Promise<void> {
  await page.locator(`${scope} .sc-rail-group[data-tools~="${type}"] .sc-rail-more`).click()
  await page.locator(`${scope} .sc-flyout-item[data-tool="${type}"]`).click()
}
