import { test, expect, openHarness, pageErrors } from './fixtures'

interface Check { step: string, ok: boolean, detail: string }

// This batch's own findings: rail rebuild-on-pick (SC-011), hotkeys (SC-095),
// Esc-cancel and stay mode (SC-094), quick measure (SC-125), magnet (SC-103),
// built-in line hit tolerance (SC-100), and the freehand brush's create-once
// and pane resolution (SC-009). See pages/drawing-input-suite.js.
test('drawing input: rail, hotkeys, Esc/stay mode, quick measure, magnet, hit tolerance, brush', async ({ page, kc }) => {
  test.setTimeout(60_000)
  await openHarness(page, kc)
  const results: Check[] = await page.evaluate(async () => {
    const suite = await import('/e2e/pages/drawing-input-suite.js' as string)
    return await suite.run()
  })
  for (const r of results) {
    expect.soft(r.ok, `${r.step}${r.detail ? ` :: ${r.detail.slice(0, 300)}` : ''}`).toBe(true)
  }
  expect(results.find(r => r.step === 'klinecharts version')?.detail).toBe(kc)
  // Known issue (2026-09-27): on klinecharts 9.7.2 only, one uncaught TypeError is thrown inside
  // klinecharts during this suite (not from this package; 9.8.12, the version the wallet ships, is clean).
  // It is tolerated here by exact message on 9.7.2 only and recorded as an annotation; any other page
  // error still fails. Root cause is tracked as a follow-up.
  const KNOWN_972 = "Uncaught TypeError: Cannot read properties of undefined (reading 'x')"
  const errors = await pageErrors(page)
  if (kc === "9.7.2" && errors.includes(KNOWN_972)) {
    test.info().annotations.push({ type: "known-issue", description: `klinecharts 9.7.2: ${KNOWN_972}` })
  }
  expect(errors.filter(e => !(kc === "9.7.2" && e === KNOWN_972))).toEqual([])
})
