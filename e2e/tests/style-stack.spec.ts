import { test, expect, openHarness, pageErrors } from './fixtures'

// The Pro engine's canvas theme and style stack: SC-038, SC-039, SC-040,
// SC-013, SC-047, SC-048, SC-068.

const FAMILY_PATHS = [
  'candle.priceMark.high.textFamily', 'candle.priceMark.low.textFamily', 'candle.priceMark.last.text.family',
  'candle.tooltip.text.family', 'indicator.lastValueMark.text.family', 'indicator.tooltip.text.family',
  'xAxis.tickText.family', 'yAxis.tickText.family', 'crosshair.horizontal.text.family',
  'crosshair.vertical.text.family', 'overlay.text.family', 'overlay.rectText.family'
]
const CANVAS_FONT = '"Helvetica Neue", "Segoe UI", Roboto, Arial, "Noto Sans", sans-serif'

test('a Broker-shaped mount gets the engine theme: solid grid, one colour per candle direction, no serif text', async ({ page, kc }, testInfo) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async (paths) => {
    const { H } = window as any
    const fonts = new Set<string>()
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: any[]) {
      fonts.add(this.font)
      return (fillText as any).apply(this, args)
    }
    const at = (o: any, p: string): unknown => p.split('.').reduce((x, k) => x?.[k], o)
    // Broker: dark, MA + VOL, no styles.
    const { pro, container } = H.mount({ chart: { mainIndicators: ['MA'], subIndicators: ['VOL'] } })
    const chart = await H.ready(pro)
    chart.resize()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    CanvasRenderingContext2D.prototype.fillText = fillText
    const s = chart.getStyles()
    const families = (): unknown[] => paths.map((p: string) => at(chart.getStyles(), p))
    const afterMount = families()
    pro.setTheme('light')
    const afterLight = families()
    pro.setTheme('dark')
    const afterDark = families()
    return {
      grid: [s.grid.horizontal.style, s.grid.vertical.style],
      bar: s.candle.bar,
      lastText: s.candle.priceMark.last.text.color,
      showRule: [s.candle.tooltip.showRule, s.indicator.tooltip.showRule],
      highShow: s.candle.priceMark.high.show,
      overlayLine: s.overlay.line.color,
      afterMount,
      afterLight,
      afterDark,
      fonts: [...fonts],
      rect: (container as HTMLElement).getBoundingClientRect().toJSON()
    }
  }, FAMILY_PATHS)
  expect(state.grid).toEqual(['solid', 'solid'])
  expect(state.bar).toMatchObject({
    upColor: '#089981', upBorderColor: '#089981', upWickColor: '#089981',
    downColor: '#F23645', downBorderColor: '#F23645', downWickColor: '#F23645'
  })
  expect(state.lastText).toBe('#131722')
  expect(state.overlayLine).toBe('#2962FF')
  // Paint only for the legend: showRule stays klinecharts' default (always
  // shown). High/low price marks are the one behaviour default the bare
  // constructor itself sets, not the canvas theme (SC-046, adopted): off,
  // so a first load is not busy. A host's own styles still win.
  expect(state.showRule).toEqual(['always', 'always'])
  expect(state.highShow).toBe(false)
  for (const families of [state.afterMount, state.afterLight, state.afterDark]) {
    expect(families).toEqual(FAMILY_PATHS.map(() => CANVAS_FONT))
  }
  // Every text the chart drew has a generic fallback (no serif on Windows/Linux).
  const text = state.fonts.filter(f => !f.includes('klinecharts-pro-icons'))
  expect(text.length).toBeGreaterThan(0)
  for (const f of text) expect(f).toMatch(/sans-serif$/)
  await page.screenshot({ path: testInfo.outputPath(`broker-dark-${kc}.png`), clip: state.rect })
  expect(await pageErrors(page)).toEqual([])
})

test('host styles survive setTheme; per-theme styles apply to their theme; raw styles survive a chart-type change', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({
      chart: {
        styles: { grid: { horizontal: { color: '#ff00ff' } }, candle: { bar: { upColor: '#00aa00' } }, yAxis: { tickText: { family: 'Courier New, monospace' } } },
        themeStyles: { light: { grid: { horizontal: { color: '#e6e8ee' } } } }
      }
    })
    const chart = await H.ready(pro)
    const read = (): unknown => {
      const s = chart.getStyles()
      return { grid: s.grid.horizontal.color, sep: s.separator.color, up: s.candle.bar.upColor, family: s.yAxis.tickText.family, gridShow: s.grid.show }
    }
    pro.setStyles({ separator: { color: '#abcdef' } })
    chart.setStyles({ grid: { show: false } }) // e.g. the Settings modal
    const mounted = read()
    pro.setTheme('light')
    const light = read()
    pro.setTheme('dark')
    const dark = read()
    // pro.setStyles(styles, { theme }) for the other theme: kept, not applied now.
    pro.setStyles({ separator: { color: '#010203' } }, { theme: 'light' })
    const notYet = read()
    pro.setTheme('light')
    const light2 = read()
    // A colour set on the raw chart survives a chart-type change from the top bar.
    chart.setStyles({ crosshair: { horizontal: { line: { color: '#123456' } } } })
    ;(container.querySelector('.klinecharts-pro-period-bar .chart-type') as HTMLElement).click()
    await H.sleep(50)
    ;([...container.querySelectorAll('.chart-type-item')] as HTMLElement[]).find(e => e.textContent === 'Bars')?.click()
    await H.sleep(50)
    const afterType = { type: chart.getStyles().candle.type, crosshair: chart.getStyles().crosshair.horizontal.line.color }
    return { mounted, light, dark, notYet, light2, afterType }
  })
  const host = { up: '#00aa00', family: 'Courier New, monospace', gridShow: false }
  expect(state.mounted).toEqual({ grid: '#ff00ff', sep: '#abcdef', ...host })
  expect(state.light).toEqual({ grid: '#e6e8ee', sep: '#abcdef', ...host })
  expect(state.dark).toEqual({ grid: '#ff00ff', sep: '#abcdef', ...host })
  expect(state.notYet).toEqual(state.dark)
  expect(state.light2).toEqual({ grid: '#e6e8ee', sep: '#010203', ...host })
  expect(state.afterType).toEqual({ type: 'ohlc', crosshair: '#123456' })
  expect(await pageErrors(page)).toEqual([])
})

test('one layout at mount and exactly one setStyles per setTheme; toggling back equals a fresh mount', async ({ page, kc }) => {
  await page.goto(`/e2e/pages/harness.html?kc=${kc}&build=umd`)
  await page.waitForFunction(() => (window as any).__ready === true)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const K = (window as any).klinecharts
    const calls: string[] = []
    const init = K.init
    // The UMD build reads klinecharts.init when it calls it, so this sees the
    // chart before the engine's first call on it.
    K.init = (...args: unknown[]) => {
      const chart = init(...args)
      for (const m of ['setStyles', 'setLocale', 'setTimezone']) {
        const f = chart[m].bind(chart)
        chart[m] = (...a: unknown[]) => { calls.push(m); return f(...a) }
      }
      return chart
    }
    const { pro } = H.mount({ chart: { theme: 'light', mainIndicators: ['MA'], subIndicators: ['VOL'] } })
    const chart = await H.ready(pro)
    // Construction includes deferred work: the data load, the redraw once the
    // fonts have loaded, anything queued on a timer or a frame.
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await H.sleep(300)
    const construction = [...calls]
    calls.length = 0
    pro.setTheme('dark')
    const oneToggle = [...calls]
    pro.setTheme('light')
    const toggled = JSON.stringify(chart.getStyles())
    const fresh = H.mount({ chart: { theme: 'light', mainIndicators: ['MA'], subIndicators: ['VOL'] } })
    const freshChart = await H.ready(fresh.pro)
    K.init = init
    return { construction, oneToggle, same: toggled === JSON.stringify(freshChart.getStyles()) }
  })
  expect(state.construction).toEqual([])
  expect(state.oneToggle).toEqual(['setStyles'])
  expect(state.same).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test("a host candle.type sets the chart type; the user's pick survives setTheme; area colours survive a chart-type switch", async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fill = [{ offset: 0, color: 'rgba(255, 0, 0, 0.1)' }, { offset: 1, color: 'rgba(255, 0, 0, 0.3)' }]
    const { pro, container } = H.mount({ chart: { styles: { candle: { type: 'area', area: { lineColor: '#ff0000', backgroundColor: fill } } } } })
    const chart = await H.ready(pro)
    const read = (): unknown => {
      const s = chart.getStyles()
      const label = (container.querySelector('.klinecharts-pro-period-bar .chart-type span') as HTMLElement).textContent
      return { type: s.candle.type, line: s.candle.area.lineColor, fill: s.candle.area.backgroundColor[1].color, label }
    }
    const pick = async (name: string): Promise<void> => {
      ;(container.querySelector('.klinecharts-pro-period-bar .chart-type') as HTMLElement).click()
      await H.sleep(30)
      ;([...container.querySelectorAll('.chart-type-item')] as HTMLElement[]).find(e => e.textContent === name)?.click()
      await H.sleep(30)
    }
    const mounted = read()
    await pick('Bars')
    const bars = read()
    pro.setTheme('light')
    const afterTheme = read()
    await pick('Line')
    const line = read()
    // A colour set on the raw chart survives a chart-type switch too.
    chart.setStyles({ candle: { area: { lineColor: '#00ff00' } } })
    await pick('Area')
    const raw = read()
    // pro.setStyles with a candle.type switches the chart type, as the top bar does.
    pro.setStyles({ candle: { type: 'ohlc' } })
    await H.sleep(30)
    const viaApi = read()
    pro.setTheme('dark')
    const viaApiDark = read()
    return { mounted, bars, afterTheme, line, raw, viaApi, viaApiDark }
  })
  // The host's fill is a host style: it wins over the engine's line/area fill.
  const host = { line: '#ff0000', fill: 'rgba(255, 0, 0, 0.3)' }
  expect(state.mounted).toEqual({ type: 'area', ...host, label: 'Area' })
  expect(state.bars).toEqual({ type: 'ohlc', ...host, label: 'Bars' })
  expect(state.afterTheme).toEqual({ type: 'ohlc', ...host, label: 'Bars' })
  expect(state.line).toEqual({ type: 'area', ...host, label: 'Line' })
  expect(state.raw).toEqual({ type: 'area', line: '#00ff00', fill: host.fill, label: 'Area' })
  expect(state.viaApi).toEqual({ type: 'ohlc', line: '#00ff00', fill: host.fill, label: 'Bars' })
  expect(state.viaApiDark).toEqual({ type: 'ohlc', ...host, label: 'Bars' })
  expect(await pageErrors(page)).toEqual([])
})

test('pro.setStyles lands under per-theme styles and Settings changes, now as after a theme switch', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { theme: 'dark', themeStyles: { dark: { grid: { horizontal: { color: '#ff0000' } } } } } })
    const chart = await H.ready(pro)
    const read = (): unknown => {
      const g = chart.getStyles().grid
      return { show: g.show, horizontal: g.horizontal.color, vertical: g.vertical.color }
    }
    // Settings > Show Grids off (the user layer).
    ;([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes('Setting'))?.click()
    await H.sleep(50)
    const row = ([...container.querySelectorAll('.klinecharts-pro-setting-modal-content span')] as HTMLElement[]).find(e => e.textContent === 'Show Grids')
    ;(row?.nextElementSibling as HTMLElement | null)?.click()
    await H.sleep(30)
    ;(container.querySelector('.klinecharts-pro-modal .close-icon') as HTMLElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await H.sleep(30)
    const settings = read()
    pro.setStyles({ grid: { show: true, horizontal: { color: '#0000ff' }, vertical: { color: '#00ff00' } } })
    const now = read()
    pro.setTheme('light')
    const light = read()
    pro.setTheme('dark')
    const dark = read()
    return { settings, now, light, dark }
  })
  expect(state.settings).toMatchObject({ show: false, horizontal: '#ff0000' })
  expect(state.now).toEqual({ show: false, horizontal: '#ff0000', vertical: '#00ff00' })
  expect(state.light).toEqual({ show: false, horizontal: '#0000ff', vertical: '#00ff00' })
  expect(state.dark).toEqual(state.now)
  expect(await pageErrors(page)).toEqual([])
})

test('Settings > Restore defaults returns to the chart type set at mount', async ({ page, kc }) => {
  await openHarness(page, kc)
  const type = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { chartType: 'area' } })
    const chart = await H.ready(pro)
    chart.setStyles({ candle: { type: 'ohlc' } })
    ;([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes('Setting'))?.click()
    await H.sleep(50)
    ;([...container.querySelectorAll('.klinecharts-pro-button')] as HTMLElement[]).find(e => e.textContent?.includes('Restore'))?.click()
    await H.sleep(50)
    return chart.getStyles().candle.type
  })
  expect(type).toBe('area')
})

for (const chartType of ['area', 'line'] as const) {
  test(`${chartType}: the series is in the accent and idles without redrawing`, async ({ page, kc }) => {
    await openHarness(page, kc)
    const state = await page.evaluate(async (chartType) => {
      const { H } = window as any
      let frames = 0
      const raf = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (cb: FrameRequestCallback) => { frames++; return raf(cb) }
      const a = H.mount({ chart: { chartType } })
      await H.ready(a.pro)
      // The Settings modal path: a raw candle.type change on a candle chart.
      const b = H.mount({ chart: { chartType: 'candle_solid' } })
      const chartB = await H.ready(b.pro)
      chartB.setStyles({ candle: { type: 'area' } })
      await document.fonts.ready
      await H.sleep(300)
      frames = 0
      await H.sleep(2000)
      const idle = frames
      // getStyles() is klinecharts' live object: copy it before changing the theme.
      const area = JSON.parse(JSON.stringify(a.pro.getChart().getStyles().candle.area))
      // A host accent (the chrome's primary token) reaches the series on setTheme.
      a.container.style.setProperty('--klinecharts-pro-primary-color', '#ff0000')
      a.pro.setTheme('light')
      const hostArea = a.pro.getChart().getStyles().candle.area
      window.requestAnimationFrame = raf
      return {
        idle,
        line: area.lineColor,
        point: area.point?.color,
        ripple: area.point?.rippleColor,
        animation: area.point?.animation,
        stops: area.backgroundColor.map((g: { color: string }) => g.color),
        host: [hostArea.lineColor, hostArea.point?.color]
      }
    }, chartType)
    // klinecharts draws through requestAnimationFrame only when something
    // changed; once the fonts have loaded and the last change is drawn, an idle
    // chart asks for no frames. (9.7.2 has no ripple animation, so there the
    // animation assertion below is the one that guards SC-047.)
    expect(state.idle, 'requestAnimationFrame calls in 2 s idle').toBe(0)
    expect(state.line).toBe('#2962FF')
    expect(state.point).toBe('#2962FF')
    expect(state.ripple).toBe('rgba(41, 98, 255, 0.3)')
    expect(state.animation).toBe(false)
    expect(state.stops).toEqual(chartType === 'line' ? ['rgba(41, 98, 255, 0)', 'rgba(41, 98, 255, 0)'] : ['rgba(41, 98, 255, 0.01)', 'rgba(41, 98, 255, 0.2)'])
    expect(state.host).toEqual(['#FF0000', '#FF0000'])
  })
}

test('legend icons follow the host tokens, and a host icon override survives setTheme', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const icons = (pro: any): unknown => pro.getChart().getStyles().indicator.tooltip.icons.map((i: any) => [i.id, i.color, i.activeBackgroundColor, i.fontFamily])
    // No host tokens.
    const plain = H.mount({ chart: { theme: 'light' } })
    await H.ready(plain.pro)
    const defaults = icons(plain.pro)
    plain.pro.setTheme('dark')
    const defaultsDark = icons(plain.pro)
    // SupWallet's vibe-studio mapping (tokens.css light values), set before mount.
    const container = document.createElement('div')
    container.className = 'chart'
    container.style.cssText = '--klinecharts-pro-text-second-color: #5B6170; --klinecharts-pro-hover-background-color: #EDEEF3; --klinecharts-pro-border-color: rgba(16, 19, 26, 0.09)'
    document.getElementById('charts')!.appendChild(container)
    const vibe = H.mount({ chart: { theme: 'light', container } })
    await H.ready(vibe.pro)
    const vibeIcons = icons(vibe.pro)
    const vibeGrid = vibe.pro.getChart().getStyles().grid.horizontal.color
    // A token in a form canvas may not read (color-mix) arrives as a plain colour.
    container.style.setProperty('--klinecharts-pro-text-second-color', 'color-mix(in srgb, #ff0000 50%, #0000ff)')
    vibe.pro.refreshTheme()
    const mixed = vibe.pro.getChart().getStyles().indicator.tooltip.icons[0].color
    // A host override of the icons.
    const hostIcons = [0, 1, 2, 3].map(i => ({ ...plain.pro.getChart().getStyles().indicator.tooltip.icons[i], color: '#123456' }))
    const custom = H.mount({ chart: { styles: { indicator: { tooltip: { icons: hostIcons } } } } })
    await H.ready(custom.pro)
    custom.pro.setTheme('light')
    custom.pro.setTheme('dark')
    const customColours = custom.pro.getChart().getStyles().indicator.tooltip.icons.map((i: any) => i.color)
    return { defaults, defaultsDark, vibeIcons, vibeGrid, mixed, customColours }
  })
  const row = (id: string, color: string, wash: string): unknown[] => [id, color, wash, 'klinecharts-pro-icons']
  const ids = ['visible', 'invisible', 'setting', 'close']
  expect(state.defaults).toEqual(ids.map(id => row(id, '#5B6270', 'rgba(53, 53, 57, 0.1)')))
  expect(state.defaultsDark).toEqual(ids.map(id => row(id, '#929AA5', 'rgba(163, 164, 213, 0.1)')))
  expect(state.vibeIcons).toEqual(ids.map(id => row(id, '#5B6170', '#EDEEF3')))
  expect(state.vibeGrid).toBe('rgba(16, 19, 26, 0.09)')
  expect(state.mixed).toBe('#800080')
  expect(state.customColours).toEqual(['#123456', '#123456', '#123456', '#123456'])
})

test('canvasFont and --sc-font-numeric set the canvas font; canvasTheme: false keeps klinecharts colours', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const a = H.mount({ chart: { canvasFont: '"Courier New", monospace' } })
    const chartA = await H.ready(a.pro)
    const container = document.createElement('div')
    container.className = 'chart'
    container.style.setProperty('--sc-font-numeric', 'Georgia, serif')
    document.getElementById('charts')!.appendChild(container)
    const b = H.mount({ chart: { container } })
    const chartB = await H.ready(b.pro)
    // canvasTheme: false next to a raw klinecharts chart given setStyles(theme).
    const c = H.mount({ chart: { canvasTheme: false } })
    const chartC = await H.ready(c.pro)
    const raw = document.createElement('div')
    raw.style.cssText = 'width:400px;height:300px'
    document.body.appendChild(raw)
    const rawChart = H.KC.init(raw)
    const pick = (s: any): unknown => ({
      grid: s.grid.horizontal.color,
      gridStyle: s.grid.horizontal.style,
      axis: s.yAxis.tickText.color,
      line: s.yAxis.axisLine.color,
      tag: s.crosshair.horizontal.text.backgroundColor,
      up: s.candle.bar.upColor,
      sep: s.separator.color
    })
    const out: Record<string, unknown> = {}
    for (const theme of ['light', 'dark']) {
      c.pro.setTheme(theme)
      rawChart.setStyles(theme)
      out[theme] = [pick(chartC.getStyles()), pick(rawChart.getStyles())]
    }
    H.KC.dispose(rawChart)
    return { a: chartA.getStyles().yAxis.tickText.family, b: chartB.getStyles().xAxis.tickText.family, ...out }
  })
  expect(state.a).toBe('"Courier New", monospace')
  expect(state.b).toBe('Georgia, serif')
  for (const theme of ['light', 'dark'] as const) {
    const [mine, raw] = state[theme] as unknown[]
    expect(mine).toEqual(raw)
  }
})

test('a segment, a brush stroke and a text label drawn in a row share one blue', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { subIndicators: [], drawingBarVisible: false } })
    const chart = await H.ready(pro)
    const data = chart.getDataList()
    const n = data.length
    const hi = Math.max(...data.slice(-60).map((d: any) => d.high))
    // Above the candles, so only the drawings are blue.
    const p = (i: number, dv: number): unknown => ({ timestamp: data[n - i].timestamp, value: hi + dv })
    chart.createOverlay({ name: 'segment', points: [p(55, 6), p(40, 12)] })
    chart.createOverlay({ name: 'horizontalSegment', points: [p(55, 3), p(40, 3)] })
    chart.createOverlay({ name: 'brush', points: [p(35, 6), p(30, 12), p(25, 7), p(20, 11)] })
    chart.createOverlay({ name: 'text', points: [p(15, 9)], extendData: 'Label' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const dom = chart.getDom('candle_pane', 'main') as HTMLElement
    const counts: Record<string, number> = {}
    for (const canvas of dom.querySelectorAll('canvas')) {
      const { data: px } = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]]
        // Anti-aliased 1px lines have few opaque pixels; above half alpha the
        // (unpremultiplied) colour is still exact to a unit or two.
        if (a >= 160 && b > 200 && r < 90 && g < 160) {
          const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
          counts[hex] = (counts[hex] ?? 0) + 1
        }
      }
    }
    return counts
  })
  const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const off = Object.keys(state).filter(c => Math.max(...rgb(c).map((v, i) => Math.abs(v - rgb('#2962ff')[i]))) > 3)
  expect(Object.values(state).reduce((a, b) => a + b, 0), 'blue pixels drawn').toBeGreaterThan(50)
  expect(off, JSON.stringify(state)).toEqual([])
})

test('with a host accent every tool draws in it: lines, brush, text, note, fills and measure', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.className = 'chart'
    // Magenta: nothing else on the chart is near it, and it is far from #2962FF.
    container.style.setProperty('--klinecharts-pro-primary-color', '#ff00ff')
    document.getElementById('charts')!.appendChild(container)
    const { pro } = H.mount({ chart: { container, subIndicators: [], drawingBarVisible: false } })
    const chart = await H.ready(pro)
    const data = chart.getDataList()
    const n = data.length
    const hi = Math.max(...data.slice(-60).map((d: any) => d.high))
    // Above the candles, so only the drawings are coloured there.
    const p = (i: number, dv: number): any => ({ timestamp: data[n - i].timestamp, value: hi + dv })
    chart.createOverlay({ name: 'segment', points: [p(58, 4), p(52, 14)] })
    chart.createOverlay({ name: 'brush', points: [p(50, 6), p(47, 12), p(44, 7)] })
    chart.createOverlay({ name: 'text', points: [p(42, 10)], extendData: 'Text' })
    chart.createOverlay({ name: 'note', points: [p(35, 10)], extendData: 'Note' })
    chart.createOverlay({ name: 'rect', points: [p(26, 3), p(18, 15)] })
    chart.createOverlay({ name: 'dateRange', points: [p(14, 3), p(4, 15)] })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const dom = chart.getDom('candle_pane', 'main') as HTMLElement
    const centre = chart.convertToPixel({ timestamp: data[n - 22].timestamp, value: hi + 9 }, { paneId: 'candle_pane' })
    const counts = { host: 0, blue: 0 }
    let fillAlpha = 0
    for (const canvas of dom.querySelectorAll('canvas')) {
      const c = canvas as HTMLCanvasElement
      const ratio = c.width / c.clientWidth
      const ctx = c.getContext('2d')!
      const { data: px } = ctx.getImageData(0, 0, c.width, c.height)
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]]
        if (a < 20) continue
        if (r > 200 && b > 200 && g < 80) counts.host++
        if (b > 200 && r < 120 && g > 60 && g < 170) counts.blue++
      }
      const [r, g, b, a] = ctx.getImageData(Math.round(centre.x * ratio), Math.round(centre.y * ratio), 1, 1).data
      if (r > 200 && b > 200 && g < 80) fillAlpha = Math.max(fillAlpha, a)
    }
    return { ...counts, fillAlpha, overlay: chart.getStyles().overlay.line.color }
  })
  expect(state.overlay).toBe('#FF00FF')
  expect(state.host, 'pixels in the host accent').toBeGreaterThan(300)
  expect(state.blue, 'pixels in a fixed blue').toBe(0)
  // The rect's fill is the accent at 15%, not the opaque polygon default.
  expect(state.fillAlpha).toBeGreaterThan(25)
  expect(state.fillAlpha).toBeLessThan(55)
  expect(await pageErrors(page)).toEqual([])
})
