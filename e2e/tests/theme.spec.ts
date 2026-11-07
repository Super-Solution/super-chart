import { test, expect, openHarness, pageErrors } from './fixtures'
import type { Page } from '@playwright/test'

// Canvas theme and the style stack (PR theme-tokens): SC-038, SC-039, SC-040,
// SC-013, SC-041, SC-047, SC-048, SC-049, SC-051, SC-068.

/** Page helpers: pixel colour counts of a pane, and a fillText font log. */
async function installHelpers (page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any
    w.frames2 = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    /** Opaque, saturated pixel colours in a pane's main area, as { '#rrggbb': count }. */
    w.paneColours = (chart: any, paneId: string, minAlpha = 255) => {
      const dom = chart.getDom(paneId, 'main') as HTMLElement
      const counts: Record<string, number> = {}
      for (const canvas of dom.querySelectorAll('canvas')) {
        const ctx = (canvas as HTMLCanvasElement).getContext('2d')!
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
          if (a < minAlpha) continue
          if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue // greys: text, grid, axis
          const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
          counts[hex] = (counts[hex] ?? 0) + 1
        }
      }
      return counts
    }
    /** Record ctx.font for every fillText from now on. */
    w.fontLog = new Set<string>()
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: any[]) {
      w.fontLog.add(this.font)
      return (fillText as any).apply(this, args)
    }
  })
}

const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
/** Largest channel difference between two '#rrggbb' colours. */
const distance = (a: string, b: string): number => Math.max(...rgb(a).map((v, i) => Math.abs(v - rgb(b)[i])))
/** The colours of `counts` that are not within 3 channel units of any of `allowed`. */
function outside (counts: Record<string, number>, allowed: string[]): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([c]) => !allowed.some(a => distance(c, a) <= 3)))
}

/** Colours with at least `min` pixels, most first. */
function dominant (counts: Record<string, number>, min: number): string[] {
  return Object.entries(counts).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

test('chartStyles (the lite theme): one up and one down colour on body, border and wick', async ({ page, kc }) => {
  await openHarness(page, kc)
  await installHelpers(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const w = window as any
    const { pro } = H.mount({ chart: { subIndicators: ['VOL'] } })
    const chart = await H.ready(pro)
    chart.setBarSpace(10)
    chart.setStyles(H.SC.chartStyles(H.KC, true))
    await w.frames2()
    const candle = w.paneColours(chart, 'candle_pane')
    const volPane = [...chart.getIndicatorByPaneId().keys()].find((id: string) => id !== 'candle_pane')
    const vol = w.paneColours(chart, volPane, 100)
    return { candle, vol, bar: chart.getStyles().candle.bar }
  })
  // Every opaque coloured pixel of the candle pane is one of the two candle colours.
  expect(outside(state.candle, ['#26a69a', '#ef5350'])).toEqual({})
  expect(state.candle['#26a69a']).toBeGreaterThan(200)
  expect(state.candle['#ef5350']).toBeGreaterThan(200)
  expect(state.bar).toMatchObject({ upWickColor: '#26a69a', upBorderColor: '#26a69a', downWickColor: '#ef5350', downBorderColor: '#ef5350' })
  // VOL bars: the same two colours (translucent), not klinecharts' 9.8 green/red.
  const vol = dominant(state.vol, 50)
  expect(vol.slice(0, 2).map(c => ['#26a69a', '#ef5350'].find(a => distance(c, a) <= 2)).sort()).toEqual(['#26a69a', '#ef5350'])
  expect(await pageErrors(page)).toEqual([])
})

test('chartStyles: the price column draws in one font', async ({ page, kc }) => {
  await openHarness(page, kc)
  await installHelpers(page)
  const fonts = await page.evaluate(async () => {
    const { H } = window as any
    const w = window as any
    const { pro } = H.mount({ chart: { subIndicators: [] } })
    const chart = await H.ready(pro)
    chart.setStyles(H.SC.chartStyles(H.KC, true))
    await w.frames2()
    w.fontLog.clear()
    // Show the crosshair over the chart so its tags draw too.
    const dom = chart.getDom('candle_pane', 'main') as HTMLElement
    const r = dom.getBoundingClientRect()
    dom.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
    chart.resize()
    await w.frames2()
    return [...w.fontLog]
  })
  const text = fonts.filter(f => !f.includes('klinecharts-pro-icons') && !f.includes('icomoon'))
  expect(text.length).toBeGreaterThan(0)
  expect([...new Set(text)]).toHaveLength(1)
  expect(text[0]).toMatch(/^(normal )?11px /)
  expect(text[0]).toContain('JetBrains Mono')
})

test('the engine theme: one up and one down colour in the candle pane, VOL in the same two', async ({ page, kc }) => {
  await openHarness(page, kc)
  await installHelpers(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const w = window as any
    // No chartStyles: the Pro engine's own theme (Broker, ProjectX).
    const { pro } = H.mount({ chart: { subIndicators: ['VOL'] } })
    const chart = await H.ready(pro)
    chart.setBarSpace(10)
    await w.frames2()
    const volPane = [...chart.getIndicatorByPaneId().keys()].find((id: string) => id !== 'candle_pane')
    return { candle: w.paneColours(chart, 'candle_pane'), vol: w.paneColours(chart, volPane, 100) }
  })
  // Blends of the tag's dark text into its fill are a few pixels each; any
  // real third colour (a border or wick in klinecharts' own green or red)
  // would be hundreds.
  const significant = Object.fromEntries(Object.entries(state.candle).filter(([, n]) => n >= 20))
  expect(outside(significant, ['#089981', '#f23645'])).toEqual({})
  expect(Object.keys(state.candle).filter(c => ['#2dc08e', '#f92855', '#26a69a', '#ef5350'].some(k => distance(c, k) <= 3))).toEqual([])
  expect(state.candle['#089981']).toBeGreaterThan(200)
  expect(state.candle['#f23645']).toBeGreaterThan(200)
  const vol = dominant(state.vol, 50)
  expect(vol.slice(0, 2).map(c => ['#089981', '#f23645'].find(a => distance(c, a) <= 2)).sort()).toEqual(['#089981', '#f23645'])
})
