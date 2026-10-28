import { test, expect, openHarness, pageErrors } from './fixtures'

interface Check { step: string, ok: boolean, detail: string }

// The drawing editor, end to end (pages/drawing-editor-suite.js): draw from the
// rail, select, the floating toolbar's colour/opacity/hex/width/style/lock/
// hide/clone/order/delete, keyboard scope, host overlays left alone, remove-all,
// scroll and zoom still working, and a symbol switch closing the toolbar (60
// checks, ported from the drawing-editor PR). 41 more were added for the
// drawing-editor batch (2026-09-27): chartPro.addHostOverlay actually reaching
// a real overlay and surviving right-click (SC-091); style memory (SC-119)
// inheriting the last-used line colour/width/dash into a fresh drawing;
// undo/redo/duplicate/copy-paste/nudge via real Ctrl+Z/Ctrl+D/Ctrl+C/Ctrl+V/
// arrow-key events (SC-092, SC-109); the right-click context menu (SC-090);
// the inline text/image editor with no window.prompt (SC-093); the objects
// panel (SC-151); and the floating toolbar's keyboard a11y — focus return,
// menu arrow-key navigation, and the hex field's visible error text (SC-150).
test('drawing editor: 101 state checks', async ({ page, kc }) => {
  test.setTimeout(240_000)
  await openHarness(page, kc)
  const results: Check[] = await page.evaluate(async () => {
    const suite = await import('/e2e/pages/drawing-editor-suite.js' as string)
    return await suite.run()
  })
  for (const r of results) {
    expect.soft(r.ok, `${r.step}${r.detail ? ` :: ${r.detail.slice(0, 300)}` : ''}`).toBe(true)
  }
  expect(results.find(r => r.step === 'klinecharts version')?.detail).toBe(kc)
  expect(results.length, 'every check ran (none skipped by an early exception)').toBe(101)
  expect(await pageErrors(page)).toEqual([])
})
