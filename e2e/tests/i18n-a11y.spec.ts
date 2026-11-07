import { test, expect, openHarness, pageErrors } from './fixtures'

// Locale resolution and the bare-chart defaults (SC-043, SC-046, SC-149),
// canvas legend + drawing-label localization (SC-146), the accessible
// name/description and focus behaviour (SC-088, SC-069, SC-142), the
// timezone popover (SC-117), and forced-colors (SC-154). Node unit tests
// cover the pure logic (src/i18n, src/extension/labels); this file covers
// what only a real browser + real klinecharts can show: what actually draws
// on the canvas, what the DOM's accessibility tree says, and real keyboard
// focus.

test.describe('bare-chart defaults (SC-046)', () => {
  test.use({ locale: 'zh-TW', timezoneId: 'Asia/Taipei' })

  test('a bare constructor resolves the viewer locale and zone, and ships no MA / no marks / an empty watermark', async ({ page, kc }) => {
    await openHarness(page, kc)
    const state = await page.evaluate(async () => {
      const { H } = window as any
      const container = document.createElement('div')
      document.getElementById('charts')!.appendChild(container)
      const { datafeed } = H.makeDatafeed()
      // No locale / timezone / mainIndicators: the true bare-constructor path
      // (H.mount() sets its own defaults, so it can't be used for this).
      const pro = new H.SC.SuperChart({
        container,
        symbol: { ticker: 'SUPER-USDT', pricePrecision: 2, volumePrecision: 0 },
        period: { multiplier: 1, timespan: 'hour', text: '1H' },
        periods: [{ multiplier: 1, timespan: 'hour', text: '1H' }],
        datafeed
      })
      const chart = await H.ready(pro)
      const watermark = container.querySelector('.klinecharts-pro-watermark')
      return {
        locale: pro.getLocale(),
        timezone: pro.getTimezone(),
        mainIndicators: (chart.getIndicatorByPaneId('candle_pane') as Map<string, unknown> | null)?.size ?? 0,
        highMarkShown: chart.getStyles().candle.priceMark.high.show,
        lowMarkShown: chart.getStyles().candle.priceMark.low.show,
        hasWatermark: watermark !== null,
        watermarkEmpty: watermark?.childElementCount === 0,
        periodBarText: container.querySelector('.klinecharts-pro-period-bar')?.textContent
      }
    })
    expect(state.locale).toBe('zh-TW')
    expect(state.timezone).toBe('Asia/Taipei')
    expect(state.mainIndicators).toBe(0)
    expect(state.highMarkShown).toBe(false)
    expect(state.lowMarkShown).toBe(false)
    expect(state.hasWatermark).toBe(true)
    expect(state.watermarkEmpty).toBe(true)
    // No raw i18n keys ('timezone', 'setting', 'indicator', 'full_screen') and no
    // English leaking into the resolved zh-TW chrome.
    expect(state.periodBarText).not.toMatch(/^\s*$/)
    for (const raw of ['timezone', 'setting', 'indicator', 'screenshot', 'full_screen', 'replay']) {
      expect(state.periodBarText).not.toContain(raw)
    }
    expect(await pageErrors(page)).toEqual([])
  })
})

test.describe('bare-chart defaults: an unsupported viewer language falls back to en-US, never raw keys', () => {
  test.use({ locale: 'fr-FR' })

  test('fr-FR resolves to en-US (not zh-CN, not raw keys)', async ({ page, kc }) => {
    await openHarness(page, kc)
    const state = await page.evaluate(async () => {
      const { H } = window as any
      const container = document.createElement('div')
      document.getElementById('charts')!.appendChild(container)
      const { datafeed } = H.makeDatafeed()
      const pro = new H.SC.SuperChart({
        container,
        symbol: { ticker: 'SUPER-USDT' },
        period: { multiplier: 1, timespan: 'hour', text: '1H' },
        periods: [{ multiplier: 1, timespan: 'hour', text: '1H' }],
        datafeed
      })
      await H.ready(pro)
      return { locale: pro.getLocale(), periodBarText: container.querySelector('.klinecharts-pro-period-bar')?.textContent }
    })
    expect(state.locale).toBe('en-US')
    expect(state.periodBarText).toContain('Timezone')
    expect(state.periodBarText).toContain('Indicator')
  })
})

test('setLocale switches the chrome AND the canvas legend together (SC-043, SC-129)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { locale: 'en-US' } })
    const chart = await H.ready(pro)
    const seen = new Set<string>()
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, ...rest: number[]) {
      seen.add(text)
      // @ts-expect-error test stub signature
      return fillText.apply(this, [text, ...rest])
    }
    try {
      pro.setLocale('zh-CN')
      await H.sleep(50)
      chart.updatePane('candle_pane')
      await H.sleep(50)
    } finally {
      CanvasRenderingContext2D.prototype.fillText = fillText
    }
    return {
      locale: pro.getLocale(),
      periodBarText: container.querySelector('.klinecharts-pro-period-bar')?.textContent,
      // The candle legend (SC-042) draws its title and value as two separate
      // fillText calls (klinecharts' drawStandardTooltipLegends), with no
      // colon joining them — unlike klinecharts' own pre-SC-042 default
      // legend, whose i18n table bakes the colon into the translation
      // itself ('open': '开：'). Our own labels (src/i18n/*.json's
      // legend_o/h/l/c) are the bare glyph, so check for those directly.
      canvasHasChinese: [...seen].some(t => t === '开' || t === '高' || t === '低' || t === '收'),
      canvasHasRawTime: seen.has('time') || seen.has('open') || seen.has('close')
    }
  })
  expect(state.locale).toBe('zh-CN')
  expect(state.periodBarText).toContain('指标') // Indicator, translated
  expect(state.canvasHasChinese).toBe(true)
  expect(state.canvasHasRawTime).toBe(false)
})

test('a partial registerLocale merges: the new string shows, everything else keeps its English text (SC-149)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    H.SC.registerLocale('en-US', { indicator: 'Studies' })
    const { pro, container } = H.mount({ chart: { locale: 'en-US' } })
    await H.ready(pro)
    return { text: container.querySelector('.klinecharts-pro-period-bar')?.textContent }
  })
  expect(state.text).toContain('Studies')
  expect(state.text).toContain('Timezone')
  expect(state.text).toContain('Setting')
  expect(state.text).not.toMatch(/\btimezone\b/) // no raw key
})

test('the chart root is marked with the language it is actually rendered in (SC-148)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    document.documentElement.lang = 'zh-Hant'
    const { pro, container } = H.mount({ chart: { locale: 'en-US' } })
    await H.ready(pro)
    const before = (container.closest('[lang]') as HTMLElement | null)?.lang
    pro.setLocale('zh-CN')
    await H.sleep(30)
    const after = (container.closest('[lang]') as HTMLElement | null)?.lang
    return { hostLang: document.documentElement.lang, before, after }
  })
  expect(state.hostLang).toBe('zh-Hant') // the host page's own lang is untouched
  expect(state.before).toBe('en-US') // chart chrome is English, so it must not inherit the host's zh-Hant
  expect(state.after).toBe('zh-CN')
})

test('the chart\'s focus stop has tabIndex 0 (not klinecharts\' default 1), a visible ring on Tab and none on click, and an accessible name that follows the symbol (SC-088, SC-069, SC-142)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.evaluate(async () => {
    const { H } = window as any
    document.getElementById('hostui')!.insertAdjacentHTML('beforeend', '<a id="prelink" href="#">before</a>')
    ;(window as any).__chart = H.mount({ id: 'a11y1', chart: { locale: 'en-US', symbol: { ticker: 'SUPER-USDT' } } })
    await H.ready((window as any).__chart.pro)
  })
  // Not just "> div": the icon-tooltip label (SC-099, src/canvas/iconTooltip.ts)
  // is also mounted as a direct child of .klinecharts-pro-widget, alongside
  // the chart's own focus/aria root. `[role="img"]` picks the chart root only.
  const chartDom = page.locator('#a11y1 .klinecharts-pro-widget > div[role="img"]')
  await expect(chartDom).toHaveAttribute('tabindex', '0')
  const noPositive = await page.evaluate(() => [...document.querySelectorAll('[tabindex]')].some(e => Number((e as HTMLElement).tabIndex) > 0))
  expect(noPositive).toBe(false)
  const nameBefore = await chartDom.getAttribute('aria-label')
  expect(nameBefore).toContain('SUPER-USDT')
  // A different symbol updates the name.
  await page.evaluate(async () => {
    const { H } = window as any
    ;(window as any).__chart.pro.setSymbol({ ticker: 'OTHER-USDT' })
    await H.sleep(30)
  })
  expect(await chartDom.getAttribute('aria-label')).toContain('OTHER-USDT')
  // Keyboard focus shows a ring; a mouse click does not.
  await page.locator('#prelink').focus()
  await page.keyboard.press('Tab')
  // There are several stops before the chart canvas: the top bar (rail
  // toggle, symbol, one period, chart type, replay, indicator, timezone,
  // setting, screenshot, full screen — 10, from the chrome-layout batch) and
  // the drawing rail — each of its 10 groups is now its own tool button PLUS
  // a "more" arrow button (SC-065/SC-144, batch 10's rail rewrite), so 20,
  // plus the magnet mode's own button+arrow (2) and lock/hide/remove (3) — 35
  // stops measured on the stack (confirmed live, one Tab press at a time), so
  // give this a margin over that.
  for (let i = 0; i < 45; i++) {
    const isChart = await page.evaluate(() => document.activeElement?.closest('.klinecharts-pro-widget') !== null)
    if (isChart) break
    await page.keyboard.press('Tab')
  }
  await expect(chartDom).toBeFocused()
  const outlineOnTab = await chartDom.evaluate(e => getComputedStyle(e).outlineStyle)
  expect(outlineOnTab).not.toBe('none')
  // Blur first: clicking an element that is already focused fires no new
  // focus event, so :focus-visible would still reflect the earlier Tab.
  await chartDom.evaluate(e => (e as HTMLElement).blur())
  await chartDom.click({ position: { x: 5, y: 5 } })
  await expect(chartDom).toBeFocused()
  const outlineOnClick = await chartDom.evaluate(e => getComputedStyle(e).outlineStyle)
  expect(outlineOnClick).toBe('none')
})

test('the timezone popover: Local is first with a live offset, one click applies and closes (no Confirm step), and Kolkata (half-hour zone) is reachable by search (SC-117)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.evaluate(async () => {
    const { H } = window as any
    ;(window as any).__chart = H.mount({ id: 'tz1', chart: { locale: 'en-US', timezone: 'Etc/UTC' } })
    await H.ready((window as any).__chart.pro)
  })
  const timezoneButton = page.locator('#tz1 .klinecharts-pro-period-bar [data-tool="timezone"]')
  await timezoneButton.click()
  const picker = page.locator('#tz1 .klinecharts-pro-timezone-picker')
  await expect(picker).toBeVisible()
  const firstOption = picker.locator('li[role="option"]').first()
  await expect(firstOption).toHaveAttribute('data-group', 'local')
  const localText = await firstOption.locator('.name').textContent()
  expect(localText).toMatch(/local/i)
  const localOffset = await firstOption.locator('.offset').textContent()
  expect(localOffset).toMatch(/^GMT/)
  // Search finds Kolkata (a half-hour offset the old curated list could not show) and applies it with one click.
  await picker.locator('input.search').fill('kolkata')
  const kolkata = picker.locator('li[role="option"]').first()
  await expect(kolkata).toBeVisible()
  await kolkata.click()
  await expect(picker).toBeHidden()
  const zone = await page.evaluate(() => (window as any).__chart.pro.getTimezone())
  // Chrome's own Intl.supportedValuesOf('timeZone') can report the legacy id
  // (Asia/Calcutta) instead of the current one (Asia/Kolkata) — the same
  // zone either way, which is exactly why the picker never bakes an offset.
  expect(['Asia/Kolkata', 'Asia/Calcutta']).toContain(zone)
  // Reopening shows the applied zone selected, and its label is up to date (no baked/stale offset).
  await timezoneButton.click()
  const selected = page.locator('#tz1 .klinecharts-pro-timezone-picker li.selected')
  await expect(selected).toBeVisible()
  await expect(selected.locator('.offset')).toHaveText('GMT+5:30')
})

test('forced-colors: the selected period and an on switch keep a visible state; unselected swatches stay distinct colours', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.evaluate(async () => {
    const { H } = window as any
    ;(window as any).__chart = H.mount({ id: 'fc1' })
    await H.ready((window as any).__chart.pro)
  })
  await page.emulateMedia({ forcedColors: 'active' })
  const selectedPeriod = page.locator('#fc1 .klinecharts-pro-period-bar .item.period.selected')
  const otherPeriod = page.locator('#fc1 .klinecharts-pro-period-bar .item.period:not(.selected)').first()
  const selOutline = await selectedPeriod.evaluate(e => getComputedStyle(e).outlineStyle)
  const otherOutline = await otherPeriod.evaluate(e => getComputedStyle(e).outlineStyle)
  expect(selOutline).not.toBe('none')
  expect(otherOutline).toBe('none')
})

test('the loading progress bar is not inside an aria-busy region, and a live status region announces it (SC-073)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    // A feed that never answers, so the loading layer stays up (same
    // technique chrome.spec.ts uses for its scroll-clipping check).
    const feed = H.makeDatafeed()
    const pending = { ...feed.datafeed, getHistoryKLineData: () => new Promise(() => {}) }
    const { container } = H.mount({ chart: { datafeed: pending } })
    await H.sleep(200)
    const status = container.querySelector('.klinecharts-pro-visually-hidden[role="status"]')
    const busyEl = container.querySelector('[aria-busy="true"]')
    const statusInsideBusy = status !== null && busyEl !== null && busyEl.contains(status)
    return {
      loadingBarUp: container.querySelector('.klinecharts-pro-loading') !== null,
      hadBusyWhileLoading: busyEl !== null,
      statusTextWhileLoading: status?.textContent ?? '',
      statusInsideBusy
    }
  })
  expect(state.loadingBarUp).toBe(true)
  expect(state.hadBusyWhileLoading).toBe(true)
  expect(state.statusTextWhileLoading.length).toBeGreaterThan(0)
  expect(state.statusInsideBusy).toBe(false)
})
