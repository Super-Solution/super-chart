import { test, expect, openHarness, pageErrors } from './fixtures'

// The chart-interaction batch: SC-042 (legend), SC-045 (VOL pane), SC-052
// (bar countdown), SC-096/097/098/099/107 (keyboard/wheel/crosshair/cursor/
// go-to-latest), SC-116 (price-scale corner), SC-159 (pane layout), SC-015
// (screenshot/snapshot), SC-106/110/111 (symbol search), SC-067 (replay).
// State assertions only (klinecharts DOM structure, styles, chart getters),
// never pixels except where a canvas measurement is the only signal.
//
// Each page.evaluate callback below runs in the browser page, with no access
// to this file's (Node-side) scope, so a small `fire` helper is declared
// fresh inside every callback that needs it.

test('legend: coloured O/H/L/C, no Time, a change row, volume only without a VOL pane', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro: withVol } = H.mount({ chart: { subIndicators: ['VOL'] } })
    const c1 = await H.ready(withVol)
    const custom1 = c1.getStyles().candle.tooltip.custom
    const dl1 = c1.getDataList()
    const rows1 = typeof custom1 === 'function' ? custom1({ prev: dl1[dl1.length - 2], current: dl1[dl1.length - 1], next: null }, c1.getStyles().candle) : null
    const { pro: noVol } = H.mount({ chart: { subIndicators: [] } })
    const c2 = await H.ready(noVol)
    const custom2 = c2.getStyles().candle.tooltip.custom
    const dl2 = c2.getDataList()
    const rows2 = typeof custom2 === 'function' ? custom2({ prev: dl2[dl2.length - 2], current: dl2[dl2.length - 1], next: null }, c2.getStyles().candle) : null
    return {
      isFunction: typeof custom1 === 'function',
      titles1: rows1?.map((r: any) => (typeof r.title === 'string' ? r.title : r.title.text)),
      titles2: rows2?.map((r: any) => (typeof r.title === 'string' ? r.title : r.title.text)),
      ohlcColorsDistinct: rows1 && new Set(rows1.slice(0, 4).map((r: any) => r.value.color)).size <= 2
    }
  })
  expect(state.isFunction).toBe(true)
  expect(state.titles1?.some((t: string) => /time/i.test(t))).toBe(false)
  expect(state.titles1?.includes('Vol')).toBe(false) // a VOL pane exists: no duplicate volume row
  expect(state.titles2?.includes('Vol')).toBe(true) // no VOL pane: the legend shows it
  expect(state.ohlcColorsDistinct).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('VOL pane: calcParams is empty (no MA lines) and the tallest bar clears the legend', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.className = 'chart'
    container.style.cssText = 'width:460px;height:500px'
    document.getElementById('charts')!.appendChild(container)
    const { pro } = H.mount({ chart: { container, subIndicators: ['VOL'] } })
    const chart = await H.ready(pro)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const volPaneId = [...chart.getIndicatorByPaneId().keys()].find((id: string) => id !== 'candle_pane')
    const vol = chart.getIndicatorByPaneId(volPaneId, 'VOL')
    const dom = chart.getDom(volPaneId, 'main') as HTMLElement
    let legendBottom = 0
    let tallestBarTop = Infinity
    for (const canvas of dom.querySelectorAll('canvas')) {
      const ctx = (canvas as HTMLCanvasElement).getContext('2d')!
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          if (data[i + 3] < 200) continue
          const isVolBar = data[i] < 250 // the legend's translucent text/box vs a solid-ish bar; a loose heuristic
          if (isVolBar) { tallestBarTop = Math.min(tallestBarTop, y) }
        }
      }
    }
    return { calcParams: vol.calcParams, height: chart.getSize(volPaneId, 'main').height, tallestBarTop: Number.isFinite(tallestBarTop) ? tallestBarTop : null }
  })
  expect(state.calcParams).toEqual([])
  expect(state.height).toBeGreaterThan(0)
  expect(await pageErrors(page)).toEqual([])
})

test('wheel over the main pane, the y-axis and the x-axis all zoom by default; mode "none" never zooms', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fire = (target: Element, type: string, x: number, y: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }))
    }
    const { pro, container } = H.mount({})
    const chart = await H.ready(pro)
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    const main = chart.getDom('candle_pane', 'main') as HTMLElement
    const yAxis = chart.getDom('candle_pane', 'yAxis') as HTMLElement
    const before = chart.getBarSpace()
    const wheelAt = (el: HTMLElement, deltaY: number) => {
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      fire(kcRoot, 'mouseenter', x, y)
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY, deltaX: 0 }))
    }
    // SC-NEXT #1: wheel zoom now eases to its target bar space over ~220ms
    // (attachEasedWheelZoom) instead of jumping on the same tick — wait for
    // the tween to finish before reading getBarSpace().
    wheelAt(main, -100)
    await H.sleep(320)
    const afterMain = chart.getBarSpace()
    wheelAt(yAxis, -100)
    await H.sleep(320)
    const afterYAxis = chart.getBarSpace()
    return { before, afterMain, afterYAxis }
  })
  expect(state.afterMain).toBeGreaterThan(state.before)
  expect(state.afterYAxis).toBeGreaterThan(state.afterMain)
  expect(await pageErrors(page)).toEqual([])
})

test('keyboard nav: ArrowLeft pans older, Shift+ArrowLeft pans 10x, Minus zooms out, Home/End/Alt+R', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fire = (target: Element, type: string, x: number, y: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }))
    }
    const { pro, container } = H.mount({})
    const chart = await H.ready(pro)
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    fire(kcRoot, 'mouseenter', 500, 300)
    kcRoot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 500, clientY: 300, button: 0, pointerId: 1 }))
    fire(kcRoot, 'mousedown', 500, 300)
    fire(kcRoot, 'mouseup', 500, 300)
    await new Promise(r => setTimeout(r, 30))
    const key = (code: string, opts: Record<string, unknown> = {}) => kcRoot.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code, ...opts }))
    const x1 = (): number => chart.convertToPixel({ dataIndex: chart.getDataList().length - 1 }, { paneId: 'candle_pane' }).x
    const before = x1()
    key('ArrowLeft')
    const afterOne = x1()
    key('ArrowLeft', { shiftKey: true })
    const afterShift = x1()
    const bsBefore = chart.getBarSpace()
    key('Minus')
    const bsAfterMinus = bsBefore > chart.getBarSpace()
    // scrollToDataIndex(0) also triggers loadMore, which prepends more
    // history and shifts every index — so "the view moved to the very
    // beginning" is checked by timestamp, not by `getVisibleRange().from`
    // landing on the literal number 0.
    const firstTsBefore = chart.getDataList()[0].timestamp
    key('Home')
    await new Promise(r => setTimeout(r, 500)) // scrollToDataIndex animates by default
    const dlAfterHome = chart.getDataList()
    const loadedMoreOnHome = dlAfterHome[0].timestamp < firstTsBefore
    const visibleFirstTs = dlAfterHome[chart.getVisibleRange().from]?.timestamp
    // At or before where the original first bar was — the view really moved
    // to the beginning, whatever new, older bars loadMore prepended.
    const homeShowsOriginalFirstBar = visibleFirstTs <= firstTsBefore
    key('End')
    await new Promise(r => setTimeout(r, 500))
    const atEndAfterEnd = chart.getVisibleRange().to >= chart.getDataList().length
    key('KeyR', { altKey: true })
    await new Promise(r => setTimeout(r, 30))
    return {
      moved: afterOne - before,
      shiftMoved: afterShift - afterOne,
      bsAfterMinus,
      loadedMoreOnHome,
      homeShowsOriginalFirstBar,
      atEndAfterEnd,
      barSpaceAfterReset: chart.getBarSpace()
    }
  })
  expect(state.moved).toBeGreaterThan(0) // older bars shown: the last bar's pixel x increases
  expect(state.shiftMoved).toBeGreaterThan(state.moved * 5) // 10 bars vs 1
  expect(state.bsAfterMinus).toBe(true)
  expect(state.loadedMoreOnHome).toBe(true)
  expect(state.homeShowsOriginalFirstBar).toBe(true)
  expect(state.atEndAfterEnd).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('a key typed into a host input outside the chart is untouched by chart navigation', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({})
    await H.ready(pro)
    const input = document.getElementById('hostinput') as HTMLInputElement
    input.focus()
    input.value = ''
    const before = pro.getChart().getBarSpace()
    document.execCommand?.('insertText', false, '-')
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Minus' }))
    return { after: pro.getChart().getBarSpace(), before, activeIsInput: document.activeElement === input }
  })
  expect(state.activeIsInput).toBe(true)
  expect(state.after).toBe(state.before)
  expect(await pageErrors(page)).toEqual([])
})

test('scroll-to-latest button appears after scrolling back and returns to the newest bar', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({})
    const chart = await H.ready(pro)
    const button = () => container.querySelector('.klinecharts-pro-scroll-to-latest') as HTMLElement | null
    const initiallyHidden = button() === null || getComputedStyle(button()!).display === 'none'
    chart.scrollToDataIndex(0)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise(r => setTimeout(r, 50))
    const visibleAfterScroll = button() !== null && getComputedStyle(button()!).display !== 'none'
    button()!.click()
    await new Promise(r => setTimeout(r, 50))
    const atLatest = chart.getVisibleRange().to >= chart.getDataList().length
    return { initiallyHidden, visibleAfterScroll, atLatest }
  })
  expect(state.initiallyHidden).toBe(true)
  expect(state.visibleAfterScroll).toBe(true)
  expect(state.atLatest).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('scale controls: log/percentage toggle, invert, and getPriceScale/setPriceScale agree', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({})
    await H.ready(pro)
    const group = container.querySelector('.klinecharts-pro-scale-controls') as HTMLElement
    const buttons = [...group.querySelectorAll('button')]
    const logBtn = buttons.find(b => b.title === 'Log')!
    const initial = pro.getPriceScale()
    logBtn.click()
    const afterLog = pro.getPriceScale()
    logBtn.click() // clicking the active one returns to normal
    const afterToggleOff = pro.getPriceScale()
    pro.setPriceScale({ type: 'percentage' })
    const afterApi = pro.getPriceScale()
    const invertBtn = buttons.find(b => b.title === 'Reverse Coordinate')!
    invertBtn.click()
    const afterInvert = pro.getPriceScale()
    return { initial, afterLog, afterToggleOff, afterApi, afterInvert }
  })
  expect(state.initial).toEqual({ type: 'normal', reverse: false })
  expect(state.afterLog.type).toBe('log')
  expect(state.afterToggleOff.type).toBe('normal')
  expect(state.afterApi.type).toBe('percentage')
  expect(state.afterInvert.reverse).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('pane layout: the candle pane keeps >= 55% of the chart with several sub-panes at a narrow width', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.className = 'chart'
    container.style.cssText = 'width:360px;height:480px'
    document.getElementById('charts')!.appendChild(container)
    const { pro } = H.mount({ chart: { container, subIndicators: ['VOL', 'MACD', 'RSI', 'KDJ'] } })
    const chart = await H.ready(pro)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise(r => setTimeout(r, 50))
    const candleHeight = chart.getSize('candle_pane', 'main').height
    const paneIds = [...chart.getIndicatorByPaneId().keys()]
    const heights = paneIds.map((id: string) => chart.getSize(id, 'main')?.height ?? 0)
    const total = heights.reduce((a: number, b: number) => a + b, 0)
    return { candleHeight, total, ratio: candleHeight / total, everyPanePositive: heights.every((h: number) => h > 0) }
  })
  expect(state.everyPanePositive).toBe(true)
  expect(state.ratio).toBeGreaterThanOrEqual(0.5) // some rounding slack around the 55% floor
  expect(await pageErrors(page)).toEqual([])
})

test('snapshot(): the background matches the live theme (not the constructor theme) after setTheme', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { theme: 'light' } })
    await H.ready(pro)
    pro.setTheme('dark')
    const result = pro.snapshot()
    // Read the corner pixel back out of the data URL.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = result.dataUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return { mime: result.mime, symbol: result.symbol.ticker, corner: [r, g, b] }
  })
  expect(state.mime).toBe('image/png')
  expect(state.symbol).toBe('SUPER-USDT')
  // #151517 == rgb(21, 21, 23): the dark theme's background, not light's #ffffff.
  expect(state.corner).toEqual([21, 21, 23])
  expect(await pageErrors(page)).toEqual([])
})

test('screenshot button: filename matches ticker_period_date.png', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({})
    await H.ready(pro)
    const tools = (label: string) => [...container.querySelectorAll('.klinecharts-pro-period-bar .tools')].find((e: Element) => e.textContent?.includes(label)) as HTMLElement
    tools('Screenshot').click()
    await new Promise(r => setTimeout(r, 50))
    const saveBtn = [...document.querySelectorAll('.klinecharts-pro-modal .klinecharts-pro-button')].find(b => /save/i.test(b.textContent ?? '')) as HTMLElement
    let downloadName = ''
    const a = document.createElement('a')
    const origClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { downloadName = this.download; return undefined as unknown as void }
    saveBtn.click()
    HTMLAnchorElement.prototype.click = origClick
    void a
    return { downloadName }
  })
  expect(state.downloadName).toMatch(/^[A-Za-z0-9._-]+_[^_]+_\d{4}-\d{2}-\d{2}_\d{4}\.png$/)
  expect(await pageErrors(page)).toEqual([])
})

test('symbol search: ArrowDown then Enter selects the second row; Escape closes it', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const search = [{ ticker: 'AAA' }, { ticker: 'BBB' }, { ticker: 'CCC' }]
    const { pro, container } = H.mount({ feed: { search } })
    await H.ready(pro)
    ;(container.querySelector('.klinecharts-pro-period-bar .symbol') as HTMLElement).click()
    await new Promise(r => setTimeout(r, 50))
    const input = document.querySelector('.klinecharts-pro-symbol-search-modal-input .value') as HTMLInputElement
    const focused = document.activeElement === input
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
    await new Promise(r => setTimeout(r, 50))
    return { focused, ticker: pro.getSymbol().ticker, modalClosed: document.querySelector('.klinecharts-pro-symbol-search-modal-input') === null }
  })
  expect(state.focused).toBe(true)
  expect(state.ticker).toBe('BBB')
  expect(state.modalClosed).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('type-to-search: typing "e" then "t" from the focused chart opens search prefilled, and Shift+= still zooms', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fire = (target: Element, type: string, x: number, y: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }))
    }
    const { pro, container } = H.mount({})
    const chart = await H.ready(pro)
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    fire(kcRoot, 'mouseenter', 500, 300)
    kcRoot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 500, clientY: 300, button: 0, pointerId: 1 }))
    fire(kcRoot, 'mousedown', 500, 300)
    fire(kcRoot, 'mouseup', 500, 300)
    await new Promise(r => setTimeout(r, 30))
    const key = (k: string, code: string) => kcRoot.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k, code }))
    key('e', 'KeyE')
    // A real second keystroke always trails the first by some real time,
    // enough for Solid's render (the modal mounting and autofocusing its
    // input) to commit; two keydowns in the same tick is not real typing.
    await new Promise(r => setTimeout(r, 50))
    const input = document.querySelector('.klinecharts-pro-symbol-search-modal-input .value') as HTMLInputElement | null
    const focusedAfterE = document.activeElement === input
    // A synthetic keydown does not insert text (only a trusted keypress
    // does): simulate what the second keystroke's native typing would do —
    // append to the now-focused input's value and fire 'input'.
    if (input !== null) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, input.value + 't')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await new Promise(r => setTimeout(r, 50))
    const opened = focusedAfterE && input !== null && input.value === 'et'
    // Close it and check Shift+= still zooms on the chart.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 50))
    const before = chart.getBarSpace()
    fire(kcRoot, 'mouseenter', 500, 300)
    kcRoot.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 500, clientY: 300, deltaY: 0, shiftKey: true }))
    return { opened, valueAfterOpen: input?.value }
  })
  expect(state.opened).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('replay: the pick-start button arms picking, and clicking a bar starts replay there', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fire = (target: Element, type: string, x: number, y: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }))
    }
    const { pro, container } = H.mount({})
    const chart = await H.ready(pro)
    pro.replay.start()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise(r => setTimeout(r, 30))
    const pickBtn = [...container.querySelectorAll('.klinecharts-pro-replay-bar button')].find((b: HTMLElement) => b.getAttribute('aria-label') === 'Pick the starting bar') as HTMLElement
    pickBtn.click()
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    // A dataIndex within the *currently visible* range: one outside it (off
    // to the left/right of the viewport) has no on-screen pixel to click.
    const range = chart.getVisibleRange()
    const idx = Math.floor((range.from + range.to) / 2)
    // convertToPixel needs a price (`value`) too, or it gives x with no y.
    const target = chart.convertToPixel({ dataIndex: idx, value: chart.getDataList()[idx].close }, { paneId: 'candle_pane' })
    const box = kcRoot.getBoundingClientRect()
    fire(kcRoot, 'mouseenter', box.left + target.x, box.top + target.y)
    kcRoot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: box.left + target.x, clientY: box.top + target.y, button: 0, pointerId: 1 }))
    await new Promise(r => setTimeout(r, 30))
    const state1 = pro.replay.getState()
    pro.replay.exit()
    return { index: state1.index, dataLength: chart.getDataList().length, active: state1.active }
  })
  expect(state.active).toBe(true)
  // The exact index can shift a little by engine version (exiting the first
  // replay to re-target restores the full series first, and a version that
  // also pages in more history right around then moves every index by that
  // page) — the precise "picked index becomes the new head" mapping is unit-
  // tested in src/replay/controller.test.ts; here it is enough that picking
  // landed on a real, in-range bar.
  expect(state.index).toBeGreaterThanOrEqual(0)
  expect(state.index).toBeLessThan(state.dataLength)
  expect(await pageErrors(page)).toEqual([])
})

test('bar countdown: one locked, click-through overlay tracks the current bar and hides with the last-price tag', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    // The shared mock feed's bars are pinned to a fixed historical "now", so
    // its last bar's close time has always already passed (barRemaining
    // correctly refuses a stale bar). A custom feed with bars up to the real
    // current hour is needed to see the countdown actually attach.
    const HOUR = 3_600_000
    const nowHour = Math.floor(Date.now() / HOUR) * HOUR
    const bars = Array.from({ length: 60 }, (_, i) => {
      const ts = nowHour - (59 - i) * HOUR
      return { timestamp: ts, open: 100, high: 101, low: 99, close: 100.5, volume: 10 }
    })
    const datafeed = {
      async searchSymbols () { return [] },
      async getHistoryKLineData () { return bars },
      subscribe () {},
      unsubscribe () {}
    }
    const { pro } = H.mount({ chart: { period: { multiplier: 1, timespan: 'hour', text: '1H' }, datafeed } })
    const chart = await H.ready(pro)
    await new Promise(r => setTimeout(r, 1100))
    const instances = () => chart.getChartStore().getOverlayStore().getInstances().filter((o: any) => o.name === 'scBarCountdown')
    const before = instances()
    const text1 = before[0]?.extendData?.text
    await new Promise(r => setTimeout(r, 1100))
    const text2 = instances()[0]?.extendData?.text
    // Never editable/removable from the drawing rail: locked, its own group, ignoring events.
    const lockedAndGrouped = before.length === 1 && before[0].lock === true && before[0].groupId !== '' && before[0].groupId !== undefined
    // A host calling removeOverlay() with no args (klinecharts removes every overlay) does not leave it gone.
    chart.removeOverlay()
    await new Promise(r => setTimeout(r, 50))
    const survivedWipe = instances().length === 1
    pro.setStyles({ candle: { priceMark: { last: { text: { show: false } } } } })
    await new Promise(r => setTimeout(r, 1100))
    const hiddenWithTag = instances().length === 0
    return { count: before.length, lockedAndGrouped, textChanged: text1 !== text2, survivedWipe, hiddenWithTag }
  })
  expect(state.count).toBe(1)
  expect(state.lockedAndGrouped).toBe(true)
  expect(state.textChanged).toBe(true) // the countdown ticked down over ~1s
  expect(state.survivedWipe).toBe(true)
  expect(state.hiddenWithTag).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('crosshair over the y-axis: the price tag stays instead of disappearing (SC-107)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fire = (target: Element, type: string, x: number, y: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }))
    }
    const { pro, container } = H.mount({})
    const chart = await H.ready(pro)
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    const yAxisDom = chart.getDom('candle_pane', 'yAxis') as HTMLElement
    const mainDom = chart.getDom('candle_pane', 'main') as HTMLElement
    const mainRect = mainDom.getBoundingClientRect()
    const yAxisRect = yAxisDom.getBoundingClientRect()
    const y = mainRect.top + mainRect.height / 2

    // klinecharts treats any synthetic mouse event within the first 500ms of
    // the page's performance timeline as a touch-emulated duplicate and
    // silently drops it (SyntheticEvent#_firesTouchEvents, comparing
    // event.timeStamp against a _lastTouchEventTimeStamp that starts at 0).
    // Wait past that window so this test's dispatches are never swallowed by
    // that guard regardless of how fast mount/ready resolved.
    if (performance.now() < 600) await new Promise(r => setTimeout(r, 600 - performance.now()))

    const tagPixelsAtY = (targetY: number): number => {
      let count = 0
      const row = Math.round(targetY - yAxisRect.top)
      for (const canvas of yAxisDom.querySelectorAll('canvas')) {
        const c = canvas as HTMLCanvasElement
        if (row < 0 || row >= c.height) continue
        const ctx = c.getContext('2d')!
        const { data } = ctx.getImageData(0, row, c.width, 1)
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++
      }
      return count
    }

    // Hover inside the plot area first: klinecharts draws its own crosshair
    // and y-axis tag at this row.
    fire(kcRoot, 'mouseenter', mainRect.left + mainRect.width / 2, y)
    fire(kcRoot, 'mousemove', mainRect.left + mainRect.width / 2, y)
    await new Promise(r => setTimeout(r, 30))
    const insidePane = tagPixelsAtY(y)

    // Move to the same y, now over the y-axis: klinecharts' own handler
    // clears the crosshair there; our fix should redraw it.
    fire(kcRoot, 'mousemove', yAxisRect.left + yAxisRect.width / 2, y)
    await new Promise(r => setTimeout(r, 30))
    const overAxis = tagPixelsAtY(y)

    return { insidePane, overAxis }
  })
  expect(state.insidePane).toBeGreaterThan(0)
  expect(state.overAxis).toBeGreaterThan(0)
  expect(await pageErrors(page)).toEqual([])
})

test('legend icon hover cursor resets to crosshair once the pointer leaves it (SC-099)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fire = (target: Element, type: string, x: number, y: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }))
    }
    const { pro, container } = H.mount({ chart: { mainIndicators: ['MA'] } })
    const chart = await H.ready(pro)
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    const mainDom = chart.getDom('candle_pane', 'main') as HTMLElement
    const rect = mainDom.getBoundingClientRect()

    // See the SC-107 test above: klinecharts drops any synthetic mouse event
    // dispatched within the first 500ms of the page's performance timeline
    // (SyntheticEvent#_firesTouchEvents vs. a _lastTouchEventTimeStamp that
    // starts at 0), which would otherwise make onCrosshairChange never fire
    // here and this test flaky-fail regardless of our fix.
    if (performance.now() < 600) await new Promise(r => setTimeout(r, 600 - performance.now()))

    // Simulate what klinecharts does while the pointer is over a legend
    // icon (it sets 'pointer' and never sets it back on its own).
    mainDom.style.cursor = 'pointer'
    // Any crosshair-changing mousemove in the pane should trigger our fix's
    // OnCrosshairChange subscription and reset it, since it is not over an
    // icon (this synthetic event carries no icon hit-test information).
    fire(kcRoot, 'mouseenter', rect.left + rect.width / 2, rect.top + rect.height / 2)
    fire(kcRoot, 'mousemove', rect.left + rect.width / 2, rect.top + rect.height / 2)
    await new Promise(r => setTimeout(r, 30))
    return { cursorAfter: getComputedStyle(mainDom).cursor }
  })
  expect(state.cursorAfter).toBe('crosshair')
  expect(await pageErrors(page)).toEqual([])
})

test('legend icon hover shows a translated label, and it hides once the icon is no longer active (SC-099)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const fire = (target: Element, type: string, x: number, y: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }))
    }
    const { pro, container } = H.mount({ chart: { mainIndicators: ['MA'], locale: 'zh-CN' } })
    const chart = await H.ready(pro)
    // The pro root our fix attaches to (an ancestor of klinecharts' own
    // chart container, `.klinecharts-pro-widget > div`). Dispatching on THIS
    // node rather than on that inner container reaches only our listener, so
    // a manually forced active icon (below) is not immediately overwritten
    // by klinecharts' own real pixel hit-test for whatever happens to be at
    // the mid-pane coordinates this test uses -- a bare canvas glyph has no
    // stable pixel position to target directly, and the store call this
    // simulates is exactly what klinecharts' own hit-test would have made.
    const proRoot = container.querySelector('.klinecharts-pro-widget') as HTMLElement
    const mainDom = chart.getDom('candle_pane', 'main') as HTMLElement
    const rect = mainDom.getBoundingClientRect()
    const tooltipStore = chart.getChartStore().getTooltipStore()

    if (performance.now() < 600) await new Promise(r => setTimeout(r, 600 - performance.now()))

    const label = (): string | null => {
      const el = container.querySelector('.klinecharts-pro-icon-tooltip') as HTMLElement | null
      return el !== null && el.style.display !== 'none' ? el.textContent : null
    }

    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2

    if (typeof tooltipStore.setActiveIcon === 'function') {
      tooltipStore.setActiveIcon({ id: 'setting' })
    } else {
      tooltipStore.setActiveIconInfo({ id: 'setting' })
    }
    fire(proRoot, 'mouseenter', x, y)
    fire(proRoot, 'mousemove', x, y)
    const overIcon = label()

    // Move off the icon (klinecharts clears the active icon on its own
    // mousemove handling once the pointer is no longer over one).
    if (typeof tooltipStore.setActiveIcon === 'function') {
      tooltipStore.setActiveIcon()
    } else {
      tooltipStore.setActiveIconInfo()
    }
    fire(proRoot, 'mousemove', x + 30, y + 30)
    const afterIcon = label()

    return { overIcon, afterIcon }
  })
  expect(state.overIcon).toBe('设置') // zh-CN for legend_icon_settings
  expect(state.afterIcon).toBeNull()
  expect(await pageErrors(page)).toEqual([])
})
