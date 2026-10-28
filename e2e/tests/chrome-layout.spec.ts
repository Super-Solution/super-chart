import { test, expect, openHarness, pageErrors } from './fixtures'
import type { Page } from '@playwright/test'

// Chrome layout and controls (chrome-layout batch): the engine's own root and
// its sizing (SC-075, SC-076, SC-086), the top bar fitting any width
// (SC-064, SC-085), its controls as buttons and menus (SC-143, SC-060), the
// dialog (SC-105, SC-078, SC-071, SC-063), form controls (SC-145), outside
// dismissal on touch (SC-083), touch affordances (SC-084, SC-087), full
// screen (SC-081), the chart type's single owner (SC-124) and parts (SC-126).

const TEN = [
  { multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' }, { multiplier: 1, timespan: 'hour', text: '1H' },
  { multiplier: 2, timespan: 'hour', text: '2H' }, { multiplier: 4, timespan: 'hour', text: '4H' },
  { multiplier: 1, timespan: 'day', text: 'D' }, { multiplier: 1, timespan: 'week', text: 'W' },
  { multiplier: 1, timespan: 'month', text: 'M' }, { multiplier: 1, timespan: 'year', text: 'Y' }
]
// Broker's six.
const SIX = [
  { multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' }, { multiplier: 1, timespan: 'hour', text: '1H' },
  { multiplier: 4, timespan: 'hour', text: '4H' }, { multiplier: 1, timespan: 'day', text: 'D' }
]
const TOOLS = ['chartType', 'replay', 'indicators', 'timezone', 'settings', 'screenshot', 'fullscreen']

/** Mount into a fresh host with this CSS text; returns its id. */
async function mountIn (page: Page, css: string, chart: Record<string, unknown> = {}, id = `h${Math.random().toString(36).slice(2, 8)}`): Promise<string> {
  await page.evaluate(async ({ css, chart, id }) => {
    const { H } = window as any
    const host = document.createElement('div')
    host.id = id
    host.style.cssText = css
    document.getElementById('charts')!.appendChild(host)
    ;(window as any)[id] = H.mount({ chart: { container: host, ...chart } })
    await H.ready((window as any)[id].pro)
    await H.sleep(60)
  }, { css, chart, id })
  return id
}

test('the top bar fits every width, locale and period list: nothing overflows, every tool is reachable, labels stay on one line', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1400, height: 900 })
  const results = await page.evaluate(async ({ TEN, SIX, TOOLS }) => {
    const { H } = window as any
    const out: any[] = []
    for (const locale of ['en-US', 'zh-CN']) {
      for (const [name, periods] of [['default', TEN], ['broker', SIX]] as const) {
        const host = document.createElement('div')
        host.style.cssText = 'width: 1280px; height: 420px; overflow: hidden'
        document.getElementById('charts')!.appendChild(host)
        const { pro } = H.mount({ chart: { container: host, locale, periods, symbol: { ticker: 'BTC-USDT', shortName: 'TSLA · broAsset', pricePrecision: 2 } } })
        await H.ready(pro)
        for (const width of [1280, 1024, 800, 664, 480, 360, 320]) {
          host.style.width = `${width}px`
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
          await H.sleep(30)
          const bar = host.querySelector('.klinecharts-pro-period-bar') as HTMLElement
          const root = host.querySelector('.klinecharts-pro-root') as HTMLElement
          const hit = (el: HTMLElement): boolean => {
            const r = el.getBoundingClientRect()
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            return at !== null && el.contains(at)
          }
          const inBar = TOOLS.filter(id => {
            const el = bar.querySelector(`[data-tool="${id}"]`) as HTMLElement | null
            return el !== null && !el.hidden && hit(el)
          })
          // Everything not in the bar is in the More menu.
          const more = bar.querySelector('.more') as HTMLElement
          let inMore: string[] = []
          if (!more.hidden) {
            more.click()
            await H.sleep(20)
            const menu = root.querySelector('.more-menu') as HTMLElement
            inMore = [...menu.querySelectorAll('[role^="menuitem"]')].filter(el => hit(el as HTMLElement)).map(el => el.textContent ?? '')
            more.click()
            await H.sleep(10)
          }
          const labels = [...bar.querySelectorAll('.label, .period[data-period]:not([hidden])')].filter(el => (el as HTMLElement).offsetParent !== null) as HTMLElement[]
          const lines = (el: HTMLElement): number => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size
          }
          const multiLine = labels.filter(el => lines(el) > 1).map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return `${el.textContent} ${JSON.stringify([...range.getClientRects()].map(r => [r.left, r.top, r.width, r.height]))}`
          })
          // The chart-type menu opens where it can be clicked (from the bar or from More).
          const trigger = bar.querySelector('[data-tool="chartType"]:not([hidden])') as HTMLElement | null
          let chartTypeMenuHit = false
          if (trigger !== null) {
            trigger.click()
            await H.sleep(20)
            const menuEl = root.querySelector('.chart-type-menu') as HTMLElement | null
            const items = [...root.querySelectorAll('.chart-type-menu [role="menuitemradio"]')] as HTMLElement[]
            // SC-NEXT #2 replaced the flat 7-item list with a grouped, favourited
            // menu (Candles/Bars/Lines/Areas, 13 curated types, plus 4 group
            // headers) — taller than the old 7-item list, so in a short chart it
            // scrolls (overflow-y: auto, the same mechanism every top-bar menu
            // already used) rather than always fitting unclipped. Only items
            // currently in view (not scrolled past the menu's own clientHeight)
            // are checked for being hit-testable; a scrolled-out item is not at
            // its natural position and reaching it is exactly what scrolling is for.
            const menuRect = menuEl?.getBoundingClientRect()
            const inView = menuRect === undefined ? [] : items.filter(el => {
              const r = el.getBoundingClientRect()
              return r.top >= menuRect.top - 1 && r.bottom <= menuRect.bottom + 1
            })
            chartTypeMenuHit = items.length === 13 && inView.length > 0 && inView.every(hit)
            trigger.click()
            await H.sleep(10)
          } else {
            chartTypeMenuHit = true
          }
          const menuCell = bar.querySelector('.menu-container') as HTMLElement
          out.push({
            case: `${locale}/${name}/${width}`,
            fits: bar.scrollWidth <= bar.clientWidth,
            rootWidth: Math.round(root.getBoundingClientRect().width),
            reachable: inBar.length + inMore.length,
            multiLine,
            menuCell: menuCell.offsetWidth,
            chartTypeMenuHit,
            size: root.dataset.size
          })
        }
        pro.dispose()
        host.remove()
      }
    }
    return out
  }, { TEN, SIX, TOOLS })
  for (const r of results) {
    const width = Number(r.case.split('/')[2])
    expect(r.fits, `${r.case}: bar scrollWidth <= clientWidth`).toBe(true)
    expect(r.rootWidth, `${r.case}: the root is the host's width`).toBe(width)
    expect(r.reachable, `${r.case}: every tool in the bar or in More`).toBe(TOOLS.length)
    expect(r.multiLine, `${r.case}: labels on one line`).toEqual([])
    expect(r.menuCell, `${r.case}: the rail toggle cell stays 52px`).toBe(52)
    expect(r.chartTypeMenuHit, `${r.case}: the chart-type menu is hit-testable`).toBe(true)
  }
  // Wide charts keep their labels; phones get the collapsed classes.
  expect(results.find(r => r.case === 'en-US/default/1280')!.size).toBe('regular')
  expect(results.find(r => r.case === 'en-US/default/320')!.size).toBe('narrow')
  expect(await pageErrors(page)).toEqual([])
})

test('a phone-width chart does not widen the page, and a desktop page gets no sideways scroll (SC-086)', async ({ browser, kc }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await openHarness(page, kc)
  const before = await page.evaluate(() => innerWidth)
  await mountIn(page, 'width: 100%; height: 500px', { periods: TEN })
  const mobile = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(mobile.inner).toBe(before)
  expect(mobile.scroll).toBeLessThanOrEqual(mobile.client)
  // Whatever is wide inside the chart (a long legend, a host's element) stays
  // inside it: the root clips across.
  const clipped = await page.evaluate(async () => {
    const wide = document.createElement('div')
    wide.style.cssText = 'position: absolute; left: 0; bottom: 0; width: 2000px; height: 4px'
    document.querySelector('.klinecharts-pro-root')!.appendChild(wide)
    await new Promise(r => setTimeout(r, 50))
    return { inner: innerWidth, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }
  })
  expect(clipped.inner).toBe(before)
  expect(clipped.scroll).toBeLessThanOrEqual(clipped.client)
  await context.close()

  const desk = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  await openHarness(desk, kc)
  await mountIn(desk, 'width: 100%; height: 500px', { periods: TEN })
  const d = await desk.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(d.scroll).toBeLessThanOrEqual(d.client)
  await desk.close()
})

test('the engine sizes its own root, never the host element (SC-075, SC-076)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1200, height: 900 })
  const warnings: string[] = []
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()) })
  await page.addStyleTag({ content: '@layer utilities { .h-240 { height: 240px } .hidden { display: none } .absolute { position: absolute } .inset-0 { inset: 0 } }' })
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const charts = document.getElementById('charts')!
    const canvasOf = (host: HTMLElement): HTMLCanvasElement => host.querySelector('.klinecharts-pro-widget canvas') as HTMLCanvasElement
    const add = (html: string): HTMLElement => {
      const wrap = document.createElement('div')
      wrap.innerHTML = html
      charts.appendChild(wrap)
      return wrap
    }
    const out: Record<string, unknown> = {}
    // An unsized host: a definite fallback height, a chart that draws.
    const w1 = add('<div id="unsized" style="width: 600px"></div>')
    const a = H.mount({ chart: { container: w1.firstElementChild } })
    await H.ready(a.pro)
    out.unsized = { root: (w1.querySelector('.klinecharts-pro-root') as HTMLElement).offsetHeight, canvas: canvasOf(w1).offsetHeight }
    // A layered utility height wins, and nothing spills out of it.
    const w2 = add('<div id="layered" class="h-240" style="width: 600px"></div>')
    const b = H.mount({ chart: { container: w2.firstElementChild } })
    await H.ready(b.pro)
    const host2 = w2.firstElementChild as HTMLElement
    // (The drawing rail's own overflow in a short chart is SC-077's, PR 10.)
    const root2 = host2.querySelector('.klinecharts-pro-root') as HTMLElement
    out.layered = { host: host2.offsetHeight, root: root2.offsetHeight, contentInside: (host2.querySelector('.klinecharts-pro-content') as HTMLElement).getBoundingClientRect().bottom <= root2.getBoundingClientRect().bottom + 0.5 }
    // Layered `hidden` and `absolute inset-0` apply to the host.
    host2.classList.add('hidden')
    out.hidden = getComputedStyle(host2).display
    host2.classList.remove('hidden')
    const w3 = add('<div style="position: relative; width: 500px; height: 300px"><div class="absolute inset-0"></div></div>')
    const c = H.mount({ chart: { container: w3.querySelector('.absolute') } })
    await H.ready(c.pro)
    out.absolute = [getComputedStyle(w3.querySelector('.absolute') as HTMLElement).position, (w3.querySelector('.klinecharts-pro-root') as HTMLElement).offsetHeight]
    // flex: 1 without min-height: 0 in a 320px column fits its column.
    const w4 = add('<div style="display: flex; flex-direction: column; height: 320px; width: 600px"><div style="height: 20px; flex: none"></div><div class="f1" style="flex: 1"></div></div>')
    const d = H.mount({ chart: { container: w4.querySelector('.f1') } })
    await H.ready(d.pro)
    out.flex = (w4.querySelector('.f1') as HTMLElement).offsetHeight
    // A 1fr column beside a 240px one: the chart is the column's share, in a wrapper too.
    const w5 = add('<div style="display: grid; grid-template-columns: 1fr 240px; width: 800px; height: 300px"><div class="g1"></div><aside></aside></div>')
    const e = H.mount({ chart: { container: w5.querySelector('.g1') } })
    await H.ready(e.pro)
    const w6 = add('<div style="display: grid; grid-template-columns: 1fr 240px; width: 800px; height: 300px"><div><div class="g2" style="height: 300px"></div></div><aside></aside></div>')
    const f = H.mount({ chart: { container: w6.querySelector('.g2') } })
    await H.ready(f.pro)
    out.grid = [(w5.querySelector('.g1') as HTMLElement).offsetWidth, (w6.querySelector('.g2') as HTMLElement).offsetWidth]
    // Shrinks 1000 -> 600 with no window resize: the canvas follows its element.
    const w7 = add('<div class="s" style="width: 1000px; height: 300px"></div>')
    const g = H.mount({ chart: { container: w7.firstElementChild } })
    await H.ready(g.pro)
    ;(w7.firstElementChild as HTMLElement).style.width = '600px'
    await H.sleep(150)
    const widget = w7.querySelector('.klinecharts-pro-widget') as HTMLElement
    // klinecharts' own container and the width it lays its panes out in
    // (without a resize() it keeps the 1000px layout: 948).
    out.shrink = [widget.offsetWidth, (widget.firstElementChild as HTMLElement).offsetWidth, g.pro.getChart().getSize('candle_pane').width]
    // Headless fills its host.
    const w8 = add('<div style="width: 500px; height: 420px"></div>')
    const hl = H.mount({ chart: { container: w8.firstElementChild, headless: true } })
    await H.ready(hl.pro)
    out.headless = [(w8.querySelector('.klinecharts-pro-root') as HTMLElement).offsetHeight, (w8.querySelector('.klinecharts-pro-content') as HTMLElement).offsetHeight]
    // The host keeps only its class and theme; dispose takes everything else away.
    const host8 = w8.firstElementChild as HTMLElement
    out.hostChildren = [...host8.children].map(el => el.className)
    hl.pro.dispose()
    out.afterDispose = [host8.className, host8.getAttribute('data-theme'), host8.children.length]
    return out
  })
  expect(state.unsized).toEqual({ root: 480, canvas: expect.any(Number) })
  expect((state.unsized as any).canvas).toBeGreaterThan(100)
  expect(warnings.some(w => w.includes('gives the chart no height'))).toBe(true)
  expect(state.layered).toEqual({ host: 240, root: 240, contentInside: true })
  expect(state.hidden).toBe('none')
  expect(state.absolute).toEqual(['absolute', 300])
  expect(state.flex).toBe(300)
  expect(state.grid).toEqual([560, 560])
  expect(state.shrink).toEqual([548, 548, 548])
  expect(state.headless).toEqual([420, 420])
  expect(state.hostChildren).toEqual(['klinecharts-pro-root'])
  expect(state.afterDispose).toEqual(['', null, 0])
  expect(await pageErrors(page)).toEqual([])
})

// Timezone is deliberately not a Modal dialog: the i18n/a11y batch (adopted)
// replaced the old select+Confirm modal with a one-click popover
// (.klinecharts-pro-timezone-picker, role="dialog" but no Modal wrapper, no
// close button by design — Escape/outside-click/picking a zone dismiss it).
// Its own fit, search and selection are covered by i18n-a11y.spec.ts; here it
// gets a narrower check (below) instead of the shared Modal assertions.
const MODALS = ['Setting', 'Indicator', 'Screenshot', 'symbol'] as const

for (const [w, h] of [[360, 360], [300, 560], [900, 240], [520, 620], [390, 600]]) {
  test(`${w}x${h} in overflow:hidden: every dialog fits, its close button can be clicked, Escape closes it (SC-078, SC-105)`, async ({ page, kc }) => {
    await openHarness(page, kc)
    await page.setViewportSize({ width: 1200, height: 900 })
    const id = await mountIn(page, `width: ${w}px; height: ${h}px; overflow: hidden`, { periods: SIX, layout: 'compact' })
    for (const modal of MODALS) {
      await page.evaluate(async ({ id, modal }) => {
        const host = document.getElementById(id)!
        if (modal === 'symbol') {
          (host.querySelector('.klinecharts-pro-period-bar .symbol') as HTMLElement).click()
          return
        }
        const ids: Record<string, string> = { Setting: 'settings', Indicator: 'indicators', Screenshot: 'screenshot' }
        const tool = host.querySelector(`[data-tool="${ids[modal]}"]`) as HTMLElement
        if (!tool.hidden) {
          tool.click()
          return
        }
        ;(host.querySelector('.more') as HTMLElement).click()
        await new Promise(r => setTimeout(r, 30))
        ;([...host.querySelectorAll('.more-menu [role^="menuitem"]')] as HTMLElement[]).find(el => el.textContent === modal)!.click()
      }, { id, modal })
      await page.waitForSelector(`#${id} .klinecharts-pro-modal [role="dialog"]`)
      const state = await page.evaluate((id) => {
        const host = document.getElementById(id)!
        const box = host.getBoundingClientRect()
        const dialog = host.querySelector('.klinecharts-pro-modal [role="dialog"]') as HTMLElement
        const d = dialog.getBoundingClientRect()
        const close = host.querySelector('.klinecharts-pro-modal .close-icon') as HTMLElement
        const c = close.getBoundingClientRect()
        const at = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)
        const content = dialog.querySelector('.content-container') as HTMLElement
        return {
          inside: d.left >= box.left - 0.5 && d.top >= box.top - 0.5 && d.right <= box.right + 0.5 && d.bottom <= box.bottom + 0.5,
          closeHit: at !== null && close.contains(at),
          closeSize: [c.width, c.height],
          closeName: close.getAttribute('aria-label'),
          named: document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent !== '',
          noSideScroll: content.scrollWidth <= content.clientWidth,
          focusInside: dialog.contains(document.activeElement)
        }
      }, id)
      expect(state, `${modal} at ${w}x${h}`).toEqual({ inside: true, closeHit: true, closeSize: [28, 28], closeName: 'Close', named: true, noSideScroll: true, focusInside: true })
      await page.keyboard.press('Escape')
      await expect(page.locator(`#${id} .klinecharts-pro-modal`)).toHaveCount(0)
    }
    // Timezone: opens and closes on Escape at this size too, even though it
    // is not a Modal (SC-105). Its horizontal position already clamps to
    // the container (src/widget/timezone-modal/index.tsx); it does not yet
    // clamp vertically, so at a short height (e.g. 900x240) the list can
    // extend past the bottom edge — a known gap, not asserted here as a
    // pass/fail (see the Integration notes).
    await page.evaluate((id) => {
      const host = document.getElementById(id)!
      const tool = host.querySelector('[data-tool="timezone"]') as HTMLElement
      if (!tool.hidden) {
        tool.click()
      } else {
        (host.querySelector('.more') as HTMLElement).click()
      }
    }, id)
    await page.waitForTimeout(30)
    const moreItem = page.locator(`#${id} .more-menu [role^="menuitem"]`, { hasText: 'Timezone' })
    if (await moreItem.count() > 0) {
      await moreItem.click()
    }
    await expect(page.locator(`#${id} .klinecharts-pro-timezone-picker[role="dialog"]`)).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator(`#${id} .klinecharts-pro-timezone-picker`)).toHaveCount(0)
    expect(await pageErrors(page)).toEqual([])
  })
}

/** Draw a segment from the rail and leave it selected (the drawing toolbar shows). */
async function drawSelected (page: Page, id: string): Promise<void> {
  const host = page.locator(`#${id}`)
  await host.locator('.klinecharts-pro-drawing-bar .item .icon-overlay-btn').first().click()
  const box = (await host.locator('.klinecharts-pro-widget').boundingBox())!
  for (let i = 0; i < 6 && await host.locator('.klinecharts-pro-drawing-toolbar').count() === 0; i++) {
    await page.mouse.click(box.x + 200, box.y + 120)
    await page.waitForTimeout(650)
  }
  await expect(host.locator('.klinecharts-pro-drawing-toolbar')).toHaveCount(1)
}

/** The chart's overlays (klinecharts' own store: v9 has no public list). */
const overlayCount = async (page: Page, id: string): Promise<number> =>
  await page.evaluate(id => {
    const list = (window as any)[id].pro.getChart().getChartStore().getOverlayStore().getInstances()
    return Array.isArray(list) ? list.length : [...list.values()].flat().length
  }, id)

test('Escape and Backspace in a dialog are the dialog\'s: the selected drawing stays, focus returns to the opener (SC-105, SC-145)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const id = await mountIn(page, 'width: 1100px; height: 560px')
  await drawSelected(page, id)
  const drawn = await overlayCount(page, id)
  expect(drawn).toBeGreaterThan(0)
  // Open Screenshot with the keyboard: Tab to its button, Enter. (Not
  // Timezone: the i18n/a11y batch's popover has no Modal wrapper and no
  // Confirm button, so it cannot stand in for the generic Modal checks
  // below — Screenshot still uses the real <Modal> with a Confirm button.)
  const opener = page.locator(`#${id} [data-tool="screenshot"]`)
  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(`#${id} .klinecharts-pro-modal`)).toHaveCount(1)
  // Backspace on the Confirm button: the drawing survives.
  // .confirm (Save), not just .klinecharts-pro-button: the screenshot modal
  // now also has a Copy image (.cancel) button (SC-015), so the bare class
  // matches two elements.
  await page.locator(`#${id} .klinecharts-pro-modal .klinecharts-pro-button.confirm`).focus()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  await expect(page.locator(`#${id} .klinecharts-pro-drawing-toolbar`)).toHaveCount(1)
  expect(await overlayCount(page, id)).toBe(drawn)
  // With nothing focused (the last press was in the chart) the dialog still
  // holds the chart's shortcuts.
  await page.evaluate(() => { (document.activeElement as HTMLElement).blur() })
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  await expect(page.locator(`#${id} .klinecharts-pro-drawing-toolbar`)).toHaveCount(1)
  expect(await overlayCount(page, id)).toBe(drawn)
  // .confirm (Save), not just .klinecharts-pro-button: the screenshot modal
  // now also has a Copy image (.cancel) button (SC-015), so the bare class
  // matches two elements.
  await page.locator(`#${id} .klinecharts-pro-modal .klinecharts-pro-button.confirm`).focus()
  // Escape closes the dialog only: the drawing stays selected.
  await page.keyboard.press('Escape')
  await expect(page.locator(`#${id} .klinecharts-pro-modal`)).toHaveCount(0)
  await expect(page.locator(`#${id} .klinecharts-pro-drawing-toolbar`)).toHaveCount(1)
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.tool)).toBe('screenshot')
  // Tab stays inside an open dialog.
  await page.keyboard.press('Enter')
  await expect(page.locator(`#${id} .klinecharts-pro-modal`)).toHaveCount(1)
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(id => document.querySelector(`#${id} .klinecharts-pro-modal`)!.contains(document.activeElement), id)).toBe(true)
  // A backdrop press closes it; a drag out of it does not.
  const modal = (await page.locator(`#${id} .klinecharts-pro-modal`).boundingBox())!
  const inner = (await page.locator(`#${id} .klinecharts-pro-modal .inner`).boundingBox())!
  await page.mouse.move(inner.x + 20, inner.y + inner.height - 20)
  await page.mouse.down()
  await page.mouse.move(modal.x + 5, modal.y + 5)
  await page.mouse.up()
  await expect(page.locator(`#${id} .klinecharts-pro-modal`)).toHaveCount(1)
  await page.mouse.click(modal.x + 5, modal.y + 5)
  await expect(page.locator(`#${id} .klinecharts-pro-modal`)).toHaveCount(0)
  // The host input beside the chart still takes typing while a dialog is open.
  await opener.click()
  await page.locator('#hostinput').fill('typed')
  expect(await page.locator('#hostinput').inputValue()).toBe('typed')
  expect(await pageErrors(page)).toEqual([])
})

test('form controls work from the keyboard and keep focus: switch, select, indicator rows (SC-145, SC-060)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const id = await mountIn(page, 'width: 1100px; height: 620px', { timezone: 'Asia/Tokyo' })
  const host = page.locator(`#${id}`)
  // Settings: Space toggles a switch, and focus stays on that same switch.
  await host.locator('[data-tool="settings"]').click()
  const sw = host.locator('.klinecharts-pro-switch').first()
  const before = await sw.getAttribute('aria-checked')
  await sw.focus()
  await page.keyboard.press(' ')
  expect(await sw.getAttribute('aria-checked')).toBe(before === 'true' ? 'false' : 'true')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('switch')
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).isConnected)).toBe(true)
  await page.keyboard.press('Enter')
  expect(await sw.getAttribute('aria-checked')).toBe(before)
  // The chart type select: ArrowDown opens it on the current value, Enter picks.
  const select = host.locator('.klinecharts-pro-setting-modal-content [role="combobox"]').first()
  await select.focus()
  await page.keyboard.press('ArrowDown')
  expect(await select.getAttribute('aria-expanded')).toBe('true')
  const active = await select.getAttribute('aria-activedescendant')
  expect(await page.locator(`#${active}`).getAttribute('aria-selected')).toBe('true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  expect(await select.getAttribute('aria-expanded')).toBe('false')
  expect(await page.evaluate(id => (window as any)[id].pro.getChartType(), id)).toBe('candle_up_stroke')
  // Escape closes the list only; the dialog stays.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  expect(await select.getAttribute('aria-expanded')).toBe('false')
  await expect(host.locator('.klinecharts-pro-modal')).toHaveCount(1)
  // Exactly one option is selected, and it carries the check.
  await page.keyboard.press('ArrowDown')
  const checked = await page.evaluate(id => {
    const list = document.querySelector(`#${id} .klinecharts-pro-select-show [role="listbox"]`)!
    return [...list.querySelectorAll('[role="option"][aria-selected="true"]')].map(li => [li.textContent, li.querySelector('svg') !== null])
  }, id)
  expect(checked).toEqual([['Hollow candles', true]])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(host.locator('.klinecharts-pro-modal')).toHaveCount(0)
  // Timezone (the i18n/a11y batch's popover, not a Modal): the current zone
  // is in view as soon as it opens, and the page does not scroll.
  const scrollY = await page.evaluate(() => window.scrollY)
  await host.locator('[data-tool="timezone"]').click()
  await host.locator('.klinecharts-pro-timezone-picker[role="dialog"]').waitFor()
  const visible = await page.evaluate(id => {
    const picker = document.querySelector(`#${id} .klinecharts-pro-timezone-picker`) as HTMLElement
    const list = picker.querySelector('[role="listbox"]') as HTMLElement
    const li = list.querySelector('[aria-selected="true"]') as HTMLElement
    const d = list.getBoundingClientRect()
    const r = li.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { inView: r.top >= d.top - 0.5 && r.bottom <= d.bottom + 0.5, hit: at !== null && li.contains(at), text: li.textContent }
  }, id)
  expect(visible).toEqual({ inView: true, hit: true, text: expect.stringContaining('Tokyo') })
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  await page.keyboard.press('Escape')
  // Indicators: rows are checkboxes; Space toggles and the row keeps focus.
  await host.locator('[data-tool="indicators"]').click()
  const row = host.locator('.klinecharts-pro-indicator-modal-list li.row').first()
  await row.focus()
  const was = await row.getAttribute('aria-checked')
  await page.keyboard.press(' ')
  expect(await row.getAttribute('aria-checked')).toBe(was === 'true' ? 'false' : 'true')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('checkbox')
  await page.keyboard.press('ArrowDown')
  expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('EMA')
  expect(await pageErrors(page)).toEqual([])
})

test('periods: arrows move focus without loading, Enter selects; the chart-type menu is a menu (SC-143, SC-060)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const id = await mountIn(page, 'width: 1200px; height: 500px', { periods: TEN })
  const host = page.locator(`#${id}`)
  const current = host.locator('.period[aria-pressed="true"]')
  await expect(current).toHaveText('1H')
  // One tab stop for the periods.
  expect(await host.locator('.period[data-period][tabindex="0"]').count()).toBe(1)
  await current.focus()
  await page.keyboard.press('ArrowRight')
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('2H')
  expect(await page.evaluate(id => (window as any)[id].pro.getPeriod().text, id)).toBe('1H')
  await page.keyboard.press('Enter')
  expect(await page.evaluate(id => (window as any)[id].pro.getPeriod().text, id)).toBe('2H')
  await expect(host.locator('.period[aria-pressed="true"]')).toHaveText('2H')
  // Chart type: ArrowDown opens the menu on the current type; exactly one is checked, with a check mark.
  const trigger = host.locator('[data-tool="chartType"]')
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = host.locator('.chart-type-menu')
  await expect(menu).toHaveAttribute('role', 'menu')
  expect(await trigger.getAttribute('aria-expanded')).toBe('true')
  const checked = await menu.evaluate(m => [...m.querySelectorAll('[aria-checked="true"]')].map(el => [el.textContent, el.querySelector('svg') !== null]))
  expect(checked).toEqual([['Candles', true]])
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-checked'))).toBe('true')
  // SC-NEXT #2's grouped menu order is Candle, Hollow Candle, Heikin Ashi,
  // then Bars — 3 ArrowDowns from Candle (was 4 in the old flat 7-item list).
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  expect(await page.evaluate(id => (window as any)[id].pro.getChartType(), id)).toBe('ohlc')
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.tool)).toBe('chartType')
  await expect(trigger).toHaveAttribute('aria-label', 'Bars')
  // Escape closes it and nothing else.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.tool)).toBe('chartType')
  // Every control in the bar has a name.
  const unnamed = await host.evaluate(h => [...h.querySelectorAll('.klinecharts-pro-period-bar button')].filter(b => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === '').map(b => b.className))
  expect(unnamed).toEqual([])
  expect(await pageErrors(page)).toEqual([])
})

test('one owner for the chart type: Settings, the bar, the host and the API agree (SC-124)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const id = await mountIn(page, 'width: 1100px; height: 560px')
  const host = page.locator(`#${id}`)
  const engineType = async (): Promise<string> => await page.evaluate(id => (window as any)[id].pro.getChart().getStyles().candle.type, id)
  // Settings > Bars (OHLC): the bar says Bars.
  await host.locator('[data-tool="settings"]').click()
  const select = host.locator('.klinecharts-pro-setting-modal-content [role="combobox"]').first()
  await select.click()
  // Exact match: SC-NEXT #2 added 'Volume Bars' to the same flat list
  // (common/chartTypes.ts's CHART_TYPE_ORDER, which Settings' chart-type
  // select still uses), and hasText's plain-string form is a substring match.
  await host.locator('.klinecharts-pro-select-show [role="option"]', { hasText: /^Bars$/ }).click()
  await host.locator('.klinecharts-pro-modal .close-icon').click()
  await expect(host.locator('[data-tool="chartType"]')).toHaveAttribute('aria-label', 'Bars')
  expect(await engineType()).toBe('ohlc')
  // Then Candles from the bar works (it was a dead click).
  await host.locator('[data-tool="chartType"]').click()
  await host.locator('.chart-type-menu [role="menuitemradio"]', { hasText: /^Candles$/ }).click()
  expect(await engineType()).toBe('candle_solid')
  // Bar Line: Settings shows Line.
  await host.locator('[data-tool="chartType"]').click()
  await host.locator('.chart-type-menu [role="menuitemradio"]', { hasText: /^Line$/ }).click()
  await host.locator('[data-tool="settings"]').click()
  await expect(host.locator('.klinecharts-pro-setting-modal-content [role="combobox"]').first().locator('.value')).toHaveText('Line')
  await page.keyboard.press('Escape')
  // Host setStyles candle.type, and the API.
  const api = await page.evaluate(id => {
    const { pro } = (window as any)[id]
    const warn = console.warn
    const warnings: string[] = []
    console.warn = (...a: unknown[]) => { warnings.push(String(a[0])) }
    pro.setStyles({ candle: { type: 'ohlc' } })
    const afterHost = document.querySelector(`#${id} [data-tool="chartType"]`)!.getAttribute('aria-label')
    const refused = pro.setChartType('bogus')
    const kept = pro.getChartType()
    const accepted = pro.setChartType('area')
    console.warn = warn
    return { afterHost, refused, kept, accepted, type: pro.getChartType(), warned: warnings.length }
  }, id)
  expect(api).toEqual({ afterHost: 'Bars', refused: false, kept: 'ohlc', accepted: true, type: 'area', warned: 1 })
  // Restore defaults puts the configured type back, through the same owner.
  await host.locator('[data-tool="settings"]').click()
  await host.locator('.klinecharts-pro-modal .klinecharts-pro-button').click()
  expect(await page.evaluate(id => (window as any)[id].pro.getChartType(), id)).toBe('candle_solid')
  expect(await engineType()).toBe('candle_solid')
  expect(await pageErrors(page)).toEqual([])
})

test('parts remove single controls; with every part on, the DOM is what it was (SC-126)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const plain = await mountIn(page, 'width: 1100px; height: 400px')
  const allOn = await mountIn(page, 'width: 1100px; height: 400px', { parts: { symbol: true, replay: true } })
  const noSymbol = await mountIn(page, 'width: 1100px; height: 400px', { parts: { symbol: false, railToggle: false } })
  const html = async (id: string): Promise<string> => await page.evaluate(id => document.querySelector(`#${id} .klinecharts-pro-period-bar`)!.outerHTML.replace(/klinecharts-pro-[a-z]+-\d+/g, 'ID'), id)
  expect(await html(allOn)).toBe(await html(plain))
  const state = await page.evaluate(id => {
    const host = document.getElementById(id)!
    const { pro } = (window as any)[id]
    const out = {
      symbol: host.querySelectorAll('.klinecharts-pro-period-bar .symbol').length,
      railToggle: host.querySelectorAll('.klinecharts-pro-period-bar .menu-container').length,
      periods: host.querySelectorAll('.period[data-period]').length,
      replay: host.querySelectorAll('[data-tool="replay"]').length,
      rail: host.querySelectorAll('.klinecharts-pro-drawing-bar').length
    }
    pro.setParts({ replay: false, screenshot: false })
    return { ...out, afterSet: [host.querySelectorAll('[data-tool="replay"]').length, host.querySelectorAll('[data-tool="screenshot"]').length, host.querySelectorAll('[data-tool="indicators"]').length], parts: pro.getParts() }
  }, noSymbol)
  expect(state).toEqual({
    symbol: 0,
    railToggle: 0,
    periods: 2,
    replay: 1,
    rail: 1,
    afterSet: [0, 0, 1],
    parts: { toolbar: true, railToggle: false, symbol: false, periods: true, chartType: true, indicators: true, replay: false, timezone: true, settings: true, screenshot: false, fullscreen: true }
  })
  // toolbar: false is headless: no bar; the rail stays.
  const noBar = await mountIn(page, 'width: 600px; height: 400px', { parts: { toolbar: false } })
  expect(await page.evaluate(id => [document.querySelectorAll(`#${id} .klinecharts-pro-period-bar`).length, document.querySelectorAll(`#${id} .klinecharts-pro-drawing-bar`).length], noBar)).toEqual([0, 1])
  expect(await pageErrors(page)).toEqual([])
})

test('the typed setters: periods, rail, watermark, layout mode (SC-124, SC-085)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const id = await mountIn(page, 'width: 1100px; height: 460px')
  const state = await page.evaluate(async id => {
    const { H } = window as any
    const { pro, feed } = (window as any)[id]
    const host = document.getElementById(id)!
    const root = host.querySelector('.klinecharts-pro-root') as HTMLElement
    const out: Record<string, unknown> = {}
    const initialRequests = (): any[] => feed.calls.history.filter((call: any) => call.firstDataRequest === true)
    const initialCount = initialRequests().length
    const subscriptionCount = feed.calls.subscribe.length
    out.initial = [initialCount, subscriptionCount]
    // Force a real older page: it must carry the native discriminator and
    // exclusive oldest-bar boundary, without reloading or resubscribing.
    const chart = pro.getChart()
    const oldest = chart.getDataList()[0].timestamp
    chart.scrollToDataIndex(0, 0)
    for (let i = 0; i < 40 && chart.getDataList()[0].timestamp >= oldest; i++) await H.sleep(50)
    const page = feed.calls.history.find((call: any) => call.firstDataRequest === false && call.before === oldest)
    out.paged = [page?.firstDataRequest, page?.period.text, page?.before === oldest, page?.to === oldest, chart.getDataList()[0].timestamp < oldest, initialRequests().length, feed.calls.subscribe.length]
    // Keeps the current period when listed. Ordinary paging is allowed;
    // any new initial request or subscription is an unintended reload.
    pro.setPeriods([{ multiplier: 1, timespan: 'hour', text: '1H' }, { multiplier: 4, timespan: 'hour', text: '4H' }])
    await H.sleep(50)
    out.kept = [pro.getPeriod().text, host.querySelectorAll('.period[data-period]').length, initialRequests().length - initialCount, feed.calls.subscribe.length - subscriptionCount]
    // Otherwise switches to the first and loads it exactly once.
    pro.setPeriods([{ multiplier: 1, timespan: 'day', text: 'D' }, { multiplier: 1, timespan: 'week', text: 'W' }])
    for (let i = 0; i < 40 && feed.calls.subscribe.at(-1)?.period.timespan !== 'day'; i++) await H.sleep(50)
    out.switched = [pro.getPeriod().text, initialRequests().at(-1)?.period.timespan, initialRequests().length - initialCount, feed.calls.subscribe.at(-1)?.period.timespan, feed.calls.subscribe.length - subscriptionCount]
    // The rail: rail + widget = root, and the canvas takes the rail's width back.
    const widget = host.querySelector('.klinecharts-pro-widget') as HTMLElement
    const rail = host.querySelector('.klinecharts-pro-drawing-bar') as HTMLElement
    out.withRail = rail.offsetWidth + widget.offsetWidth - root.offsetWidth
    pro.setDrawingBarVisible(false)
    await H.sleep(150)
    out.withoutRail = [host.querySelectorAll('.klinecharts-pro-drawing-bar').length, widget.offsetWidth === root.offsetWidth, pro.getChart().getSize('candle_pane').width === root.offsetWidth, pro.isDrawingBarVisible()]
    pro.setDrawingBarVisible(true)
    // Watermark text is text.
    pro.setWatermark('<img src=x onerror=alert(1)>')
    const wm = host.querySelector('.klinecharts-pro-watermark') as HTMLElement
    out.watermark = [host.querySelectorAll('.klinecharts-pro-watermark').length, wm.textContent, wm.querySelector('img')]
    // A forced layout.
    pro.setLayoutMode('narrow')
    await H.sleep(80)
    out.narrow = [root.dataset.size, pro.getSizeClass(), (host.querySelector('.period-menu') as HTMLElement).hidden, host.querySelectorAll('.klinecharts-pro-drawing-bar').length]
    pro.setLayoutMode('auto')
    await H.sleep(80)
    out.auto = [root.dataset.size, host.querySelectorAll('.klinecharts-pro-drawing-bar').length]
    return out
  }, id)
  expect(state).toEqual({
    initial: [1, 1],
    paged: [false, '1H', true, true, true, 1, 1],
    kept: ['1H', 2, 0, 0],
    switched: ['D', 'day', 1, 'day', 1],
    withRail: 0,
    withoutRail: [0, true, true, false],
    watermark: [1, '<img src=x onerror=alert(1)>', null],
    narrow: ['narrow', 'narrow', false, 0],
    auto: ['regular', 1]
  })
  expect(await pageErrors(page)).toEqual([])
})

test('Settings: one row per setting, labels and the button on one line, a clear gap; dialog lists edge to edge (SC-063, SC-071)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.addStyleTag({ content: '#charts { font-family: Arial, sans-serif }' })
  for (const locale of ['en-US', 'zh-CN']) {
    const id = await mountIn(page, 'width: 1100px; height: 400px', { locale })
    await page.locator(`#${id} [data-tool="settings"]`).click()
    const state = await page.evaluate(id => {
      const host = document.getElementById(id)!
      const root = host.querySelector('.klinecharts-pro-root')!.getBoundingClientRect()
      const lines = (el: Element): number => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size
      }
      const labels = [...host.querySelectorAll('.klinecharts-pro-setting-modal-content > .label')]
      const gaps = labels.map(label => {
        const range = document.createRange()
        range.selectNodeContents(label)
        const text = [...range.getClientRects()].pop()!
        return (label.nextElementSibling as HTMLElement).getBoundingClientRect().left - text.right
      })
      const button = host.querySelector('.klinecharts-pro-modal .klinecharts-pro-button') as HTMLElement
      const title = host.querySelector('.klinecharts-pro-modal .title-container')!.getBoundingClientRect()
      const buttons = host.querySelector('.klinecharts-pro-modal .button-container')!.getBoundingClientRect()
      return {
        multiLineLabels: labels.filter(l => lines(l) > 1).map(l => l.textContent),
        minGap: Math.min(...gaps),
        buttonLines: lines(button),
        buttonKind: button.classList.contains('cancel'),
        titleInside: title.top >= root.top && title.bottom <= root.bottom,
        buttonsInside: buttons.top >= root.top && buttons.bottom <= root.bottom
      }
    }, id)
    expect(state, locale).toEqual({ multiLineLabels: [], minGap: expect.any(Number), buttonLines: 1, buttonKind: true, titleInside: true, buttonsInside: true })
    expect(state.minGap, locale).toBeGreaterThanOrEqual(16)
    await page.keyboard.press('Escape')
  }
  // The indicator list spans the dialog; its rows line up with the title.
  const id = await mountIn(page, 'width: 1100px; height: 620px')
  await page.locator(`#${id} [data-tool="indicators"]`).click()
  const list = await page.evaluate(id => {
    const host = document.getElementById(id)!
    const inner = host.querySelector('.klinecharts-pro-modal .inner')!.getBoundingClientRect()
    const ul = host.querySelector('.klinecharts-pro-indicator-modal-list') as HTMLElement
    const u = ul.getBoundingClientRect()
    const row = ul.querySelector('li.row') as HTMLElement
    const r = row.getBoundingClientRect()
    const titleText = host.querySelector('.klinecharts-pro-modal .title')!.getBoundingClientRect()
    const rowText = row.querySelector('.label')!.getBoundingClientRect()
    const icon = row.querySelector('svg')!.getBoundingClientRect()
    return {
      flush: [Math.round(u.left - inner.left), Math.round(inner.right - u.right)],
      rowFull: [Math.round(r.left - u.left), Math.round(u.right - r.right) - (ul.offsetWidth - ul.clientWidth)],
      textAligned: Math.round(icon.left - titleText.left),
      rowTextAfterIcon: rowText.left > icon.right
    }
  }, id)
  // The inner box has a 1px border.
  expect(list).toEqual({ flush: [1, 1], rowFull: [0, 0], textAligned: 0, rowTextAfterIcon: true })
  await page.keyboard.press('Escape')
  // The screenshot fits the dialog's body, as wide on the left as on the right.
  await page.locator(`#${id} [data-tool="screenshot"]`).click()
  const img = await page.evaluate(id => {
    const host = document.getElementById(id)!
    const content = host.querySelector('.klinecharts-pro-modal .content-container') as HTMLElement
    const c = content.getBoundingClientRect()
    const i = (content.querySelector('img') as HTMLElement).getBoundingClientRect()
    return [Math.round(i.left - c.left), Math.round(c.right - i.right), content.scrollWidth <= content.clientWidth]
  }, id)
  expect(img[0]).toBe(img[1])
  expect(img[2]).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('narrow collapses the rail through state; the canvas takes its width, and it comes back (SC-085)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const id = await mountIn(page, 'width: 1100px; height: 460px')
  const state = await page.evaluate(async id => {
    const { H } = window as any
    const { pro } = (window as any)[id]
    const host = document.getElementById(id)!
    const root = host.querySelector('.klinecharts-pro-root') as HTMLElement
    const snap = (): unknown => ({
      size: root.dataset.size,
      rail: host.querySelectorAll('.klinecharts-pro-drawing-bar').length,
      widget: (host.querySelector('.klinecharts-pro-widget') as HTMLElement).offsetWidth === root.offsetWidth - (host.querySelector('.klinecharts-pro-drawing-bar') as HTMLElement | null ?? { offsetWidth: 0 }).offsetWidth,
      canvas: pro.getChart().getSize('candle_pane').width === (host.querySelector('.klinecharts-pro-widget') as HTMLElement).offsetWidth
    })
    const wide = snap()
    host.style.width = '360px'
    await H.sleep(200)
    const narrow = snap()
    // The toggle still opens it; that choice is kept.
    ;(host.querySelector('.menu-container') as HTMLElement).click()
    await H.sleep(200)
    const opened = snap()
    ;(host.querySelector('.menu-container') as HTMLElement).click()
    await H.sleep(200)
    host.style.width = '1100px'
    await H.sleep(200)
    const back = snap()
    return { wide, narrow, opened, back }
  }, id)
  expect(state).toEqual({
    wide: { size: 'regular', rail: 1, widget: true, canvas: true },
    narrow: { size: 'narrow', rail: 0, widget: true, canvas: true },
    opened: { size: 'narrow', rail: 1, widget: true, canvas: true },
    back: { size: 'regular', rail: 0, widget: true, canvas: true }
  })
  expect(await pageErrors(page)).toEqual([])
})

test('full screen follows the page: another chart or element, a refused request, no API at all (SC-081)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const a = await mountIn(page, 'width: 900px; height: 360px')
  const b = await mountIn(page, 'width: 900px; height: 360px')
  const pressed = async (id: string): Promise<string | null> => await page.locator(`#${id} [data-tool="fullscreen"]`).getAttribute('aria-pressed')
  // A native full screen of chart A (a real click: user activation).
  await page.locator(`#${a} [data-tool="fullscreen"]`).click()
  await page.waitForFunction(() => document.fullscreenElement !== null)
  expect(await page.evaluate(a => document.fullscreenElement === document.querySelector(`#${a} .klinecharts-pro-root`), a)).toBe(true)
  expect([await pressed(a), await pressed(b)]).toEqual(['true', 'false'])
  // A chart mounted during it starts off.
  const c = await mountIn(page, 'width: 600px; height: 300px')
  expect(await pressed(c)).toBe('false')
  await page.locator(`#${a} [data-tool="fullscreen"]`).click()
  await page.waitForFunction(() => document.fullscreenElement === null)
  expect([await pressed(a), await pressed(b), await pressed(c)]).toEqual(['false', 'false', 'false'])
  // An unrelated element (a video player) in full screen changes no chart.
  await page.evaluate(() => { const v = document.createElement('div'); v.id = 'video'; v.textContent = 'video'; document.body.appendChild(v) })
  await page.locator('#video').click()
  await page.evaluate(async () => { await document.getElementById('video')!.requestFullscreen() })
  await page.waitForFunction(() => document.fullscreenElement !== null)
  expect([await pressed(a), await pressed(b)]).toEqual(['false', 'false'])
  await page.evaluate(async () => { await document.exitFullscreen() })
  // A refused request (an iframe without allow="fullscreen"): maximised in the page.
  await page.evaluate(() => {
    ;(window as any).__request = Element.prototype.requestFullscreen
    Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Disallowed by permissions policy')) }
  })
  await page.locator(`#${b} [data-tool="fullscreen"]`).click()
  await page.waitForTimeout(50)
  const pseudo = await page.evaluate(b => {
    const root = document.querySelector(`#${b} .klinecharts-pro-root`) as HTMLElement
    const r = root.getBoundingClientRect()
    return { cls: root.classList.contains('klinecharts-pro-pseudo-fullscreen'), box: [r.left, r.top, r.width, r.height], fs: (window as any)[b].pro.isFullscreen(), modal: null as string | null }
  }, b)
  expect(pseudo).toEqual({ cls: true, box: [0, 0, 1300, 900], fs: true, modal: null })
  expect(await pressed(b)).toBe('true')
  // A dialog opened now is modal for assistive technology.
  await page.locator(`#${b} [data-tool="settings"]`).click()
  expect(await page.locator(`#${b} [role="dialog"]`).getAttribute('aria-modal')).toBe('true')
  await page.keyboard.press('Escape')
  await expect(page.locator(`#${b} [role="dialog"]`)).toHaveCount(0)
  // That Escape closed the dialog only; the next one leaves full screen.
  expect(await pressed(b)).toBe('true')
  await page.keyboard.press('Escape')
  await expect.poll(async () => await pressed(b)).toBe('false')
  // No Fullscreen API at all (iPhone Safari), from the API without a gesture: pseudo, and the event.
  const api = await page.evaluate(async a => {
    delete (Element.prototype as any).requestFullscreen
    delete (Element.prototype as any).webkitRequestFullscreen
    const events: unknown[] = []
    const { H } = window as any
    const host = document.createElement('div')
    host.style.cssText = 'width: 500px; height: 300px'
    document.getElementById('charts')!.appendChild(host)
    const { pro } = H.mount({ chart: { container: host, onFullscreenChange: (e: unknown) => { events.push(e) } } })
    await H.ready(pro)
    const entered = await pro.enterFullscreen()
    const state = [pro.isFullscreen(), host.querySelector('.klinecharts-pro-root')!.classList.contains('klinecharts-pro-pseudo-fullscreen')]
    await pro.exitFullscreen()
    Element.prototype.requestFullscreen = (window as any).__request
    return { entered, state, after: pro.isFullscreen(), events, a: (window as any)[a].pro.isFullscreen() }
  }, a)
  expect(api).toEqual({ entered: 'pseudo', state: [true, true], after: false, events: [{ mode: 'pseudo' }, { mode: null }], a: false })
  expect(await pageErrors(page)).toEqual([])
})

test('Escape in the pseudo full screen with a drawing selected only deselects it (SC-081)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.setViewportSize({ width: 1300, height: 900 })
  const id = await mountIn(page, 'width: 1100px; height: 560px', { fullscreen: 'pseudo' })
  await page.locator(`#${id} [data-tool="fullscreen"]`).click()
  expect(await page.evaluate(id => (window as any)[id].pro.isFullscreen(), id)).toBe(true)
  await drawSelected(page, id)
  await page.keyboard.press('Escape')
  await expect(page.locator(`#${id} .klinecharts-pro-drawing-toolbar`)).toHaveCount(0)
  await page.waitForTimeout(50)
  expect(await page.evaluate(id => (window as any)[id].pro.isFullscreen(), id)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(async () => await page.evaluate(id => (window as any)[id].pro.isFullscreen(), id)).toBe(false)
  expect(await pageErrors(page)).toEqual([])
})

test.describe('touch', () => {
  test.use({ hasTouch: true })

  test('a real touch tap or pan on the canvas closes the menus and the rail flyout; brush mode clicks too (SC-083)', async ({ page, kc }) => {
    await openHarness(page, kc)
    await page.setViewportSize({ width: 1300, height: 900 })
    const id = await mountIn(page, 'width: 1100px; height: 560px')
    const host = page.locator(`#${id}`)
    const canvas = (await host.locator('.klinecharts-pro-widget').boundingBox())!
    // Well clear of every popover this test opens, including the taller
    // SC-NEXT #2 grouped chart-type menu (13 items + 4 group headers, up to
    // ~475px tall and 200px wide, anchored near the top-left of the bar) —
    // the old flat 7-item menu fit inside canvas.x+400/canvas.y+200, this one does not.
    const at = { x: canvas.x + 900, y: canvas.y + 450 }
    // Tap.
    await host.locator('[data-tool="chartType"]').click()
    await expect(host.locator('.chart-type-menu')).toHaveCount(1)
    await page.touchscreen.tap(at.x, at.y)
    await expect(host.locator('.chart-type-menu')).toHaveCount(0)
    await host.locator('.klinecharts-pro-drawing-bar .item .icon-arrow').first().click()
    await expect(host.locator('.klinecharts-pro-drawing-bar-flyout')).toHaveCount(1)
    await page.touchscreen.tap(at.x, at.y)
    await expect(host.locator('.klinecharts-pro-drawing-bar-flyout')).toHaveCount(0)
    // Pan (real touch events through CDP).
    const cdp = await page.context().newCDPSession(page)
    const pan = async (): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] })
      for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x - 20 * i, y: at.y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await host.locator('[data-tool="chartType"]').click()
    await pan()
    await expect(host.locator('.chart-type-menu')).toHaveCount(0)
    await host.locator('.klinecharts-pro-drawing-bar .item .icon-arrow').first().click()
    await pan()
    await expect(host.locator('.klinecharts-pro-drawing-bar-flyout')).toHaveCount(0)
    // The trigger still toggles it, without a flicker.
    await host.locator('[data-tool="chartType"]').click()
    await host.locator('[data-tool="chartType"]').click()
    await expect(host.locator('.chart-type-menu')).toHaveCount(0)
    // Brush mode: its pointerdown handler cancels the mouse events.
    await host.locator('.klinecharts-pro-drawing-bar .item').nth(8).locator('.icon-overlay-btn').first().click()
    await host.locator('[data-tool="chartType"]').click()
    await page.mouse.click(at.x, at.y)
    await expect(host.locator('.chart-type-menu')).toHaveCount(0)
    expect(await pageErrors(page)).toEqual([])
  })

  test('coarse pointers: fields are 16px, hit areas grow, the rail chevron shows and does not steal icon taps (SC-084, SC-087)', async ({ page, kc }) => {
    await openHarness(page, kc)
    await page.setViewportSize({ width: 1300, height: 900 })
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    test.skip(!coarse, 'this browser does not emulate a coarse pointer with hasTouch')
    const id = await mountIn(page, 'width: 1100px; height: 620px', { periods: TEN })
    const host = page.locator(`#${id}`)
    const sizes = await page.evaluate(id => {
      const host = document.getElementById(id)!
      const probe = document.createElement('div')
      probe.innerHTML = '<div class="klinecharts-pro-input"><input class="value"></div><div class="klinecharts-pro-drawing-toolbar"><input class="tb-hex"></div>'
      host.querySelector('.klinecharts-pro-root')!.appendChild(probe)
      const out = [...probe.querySelectorAll('input')].map(i => getComputedStyle(i).fontSize)
      probe.remove()
      return out
    }, id)
    expect(sizes).toEqual(['16px', '16px'])
    // A tap just outside a period chip still selects it.
    const chip = (await host.locator('.period[data-period]', { hasText: '4H' }).boundingBox())!
    await page.touchscreen.tap(chip.x + chip.width / 2, chip.y - 5)
    expect(await page.evaluate(id => (window as any)[id].pro.getPeriod().text, id)).toBe('4H')
    // The rail's chevron is visible without hover; a tap at the icon's right edge arms the tool.
    const item = host.locator('.klinecharts-pro-drawing-bar .item').first()
    expect(await item.locator('.icon-arrow').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    const icon = (await item.locator('.icon-overlay-btn').first().boundingBox())!
    const arrow = (await item.locator('.icon-arrow').boundingBox())!
    expect(arrow.x).toBeGreaterThanOrEqual(icon.x + icon.width)
    await page.touchscreen.tap(icon.x + icon.width - 2, icon.y + icon.height / 2)
    await expect(host.locator('.klinecharts-pro-drawing-bar-flyout')).toHaveCount(0)
    expect(await pageErrors(page)).toEqual([])
  })
})

test('fine pointers keep the desktop look: 14px fields, no enlarged hit areas (SC-087, SC-084)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 1100px; height: 400px')
  const state = await page.evaluate(id => {
    const host = document.getElementById(id)!
    const probe = document.createElement('div')
    probe.innerHTML = '<div class="klinecharts-pro-input"><input class="value"></div><div class="klinecharts-pro-drawing-toolbar"><div class="tb-field"><input class="tb-hex"></div></div>'
    host.querySelector('.klinecharts-pro-root')!.appendChild(probe)
    const out = [...probe.querySelectorAll('input')].map(i => getComputedStyle(i).fontSize)
    probe.remove()
    return { out, after: getComputedStyle(host.querySelector('.period[data-period]')!, '::after').content }
  }, id)
  expect(state.out[0]).toBe('14px')
  expect(state.out[1]).not.toBe('16px')
  expect(state.after).toBe('none')
})
