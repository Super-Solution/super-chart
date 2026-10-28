import { test, expect, openHarness, pageErrors } from './fixtures'

// SC-legend-fmt: reported bug, a price of 90,620.30 rendered in the candle
// legend as "O90620.0n/a30" (ProjectX's side panel, Super Chart 0.0.33 and
// 0.0.34, both on klinecharts 9.8.12). Root cause (legend.ts,
// formatLegendNumber): ChartProComponent.tsx tried to read
// widget.getThousandsSeparator()/widget.getDecimalFoldThreshold(), which
// never exist on the public klinecharts Chart type on any version (only the
// internal ChartStore has them) — so both always resolved to undefined, and
// formatLegendNumber's old fallback (''/0) let formatFoldDecimal's fold
// regex match on an ordinary decimal (threshold 0 requires zero leading
// zeros), splicing a literal "0{n}" into the price text. Reproduced here
// against the real, BUILT package in a real browser, on both klinecharts
// versions this repo tests (9.7.2 has no formatFoldDecimal at all, so only
// the missing thousands separator would have shown there; 9.8.12 is the
// version that corrupted the string). See src/canvas/legend.test.ts for the
// unit-level reproduction against klinecharts' own dist utils directly.

async function legendRows (page: import('@playwright/test').Page, current: Record<string, number>, prev: Record<string, number>, pricePrecision = 2): Promise<{ isFunction: boolean, titles: string[], values: string[] }> {
  return await page.evaluate(async ({ current, prev, pricePrecision }) => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { subIndicators: ['VOL'], symbol: { ticker: 'SUPER-USDT', pricePrecision, volumePrecision: 0 } } })
    const chart = await H.ready(pro)
    const custom = chart.getStyles().candle.tooltip.custom
    const rows = typeof custom === 'function' ? custom({ prev, current, next: null }, chart.getStyles().candle) : null
    const text = (r: any): string => (typeof r.value === 'string' ? r.value : r.value.text)
    const title = (r: any): string => (typeof r.title === 'string' ? r.title : r.title.text)
    return {
      isFunction: typeof custom === 'function',
      titles: rows?.map(title) ?? [],
      values: rows?.map(text) ?? []
    }
  }, { current, prev, pricePrecision })
}

test('candle legend: a price with a non-trailing-zero decimal (90620.30) formats with a thousands separator and no fold-marker junk', async ({ page, kc }) => {
  await openHarness(page, kc)
  const current = { timestamp: 0, open: 90620.30, high: 90650.10, low: 90600.00, close: 90620.30, volume: 1234 }
  const prev = { timestamp: -3_600_000, open: 90000, high: 90100, low: 89900, close: 90000, volume: 1000 }
  const { isFunction, titles, values } = await legendRows(page, current, prev)
  expect(isFunction).toBe(true)
  const openText = values[titles.indexOf('O')]
  expect(openText).toBe('90,620.30')
  // No row anywhere carries a stray "{"/"}" fold-marker spliced into a
  // number — the general shape of the bug, not just this one reported value.
  for (const text of values) {
    expect(text).not.toMatch(/[{}]/)
  }
  expect(await pageErrors(page)).toEqual([])
})

test('candle legend: a genuinely tiny price still folds using the real default threshold (3) on klinecharts versions that support it', async ({ page, kc }) => {
  await openHarness(page, kc)
  // pricePrecision 10 so ctx.getPrecision (getPriceVolumePrecision) does not
  // clip the tiny value away before formatFoldDecimal ever sees it.
  const current = { timestamp: 0, open: 0.0000001234, high: 0.0000001300, low: 0.0000001200, close: 0.0000001234, volume: 1234 }
  const prev = { timestamp: -3_600_000, open: 0.0000001000, high: 0.0000001100, low: 0.0000000900, close: 0.0000001000, volume: 1000 }
  const { isFunction, titles, values } = await legendRows(page, current, prev, 10)
  expect(isFunction).toBe(true)
  const openText = values[titles.indexOf('O')]
  if (kc === '9.7.2') {
    // No formatFoldDecimal on this version: precision + thousands only, no
    // fold marker, and (correctly) not disabled/corrupted either.
    expect(openText).toBe('0.0000001234')
  } else {
    expect(openText).toBe('0.0{6}1234')
  }
  expect(await pageErrors(page)).toEqual([])
})
