import { test, expect, openHarness, pageErrors } from './fixtures'

// Chrome CSS: SC-053 (icon font scope), SC-054/SC-055 (contrast, hover vs
// selected), SC-056 (floating surfaces), SC-061 (color-scheme), SC-062
// (control fonts), SC-066 (list text colour), SC-070 (type scale), SC-079
// (stacking context).

test('the icon font stays inside the chart, and the legend icons draw in it', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const host = document.createElement('span')
    host.className = 'icon-home host-bold'
    host.style.cssText = 'font-family: Georgia, serif; font-weight: 700; text-transform: uppercase'
    host.textContent = 'host'
    document.getElementById('hostui')!.appendChild(host)
    const fonts = new Set<string>()
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: any[]) {
      fonts.add(this.font)
      return (fillText as any).apply(this, args)
    }
    const { pro, container } = H.mount({ chart: { mainIndicators: ['MA'] } })
    await H.ready(pro)
    // The engine redraws once the icon font has loaded; give it that long.
    await document.fonts.load('14px "klinecharts-pro-icons"')
    await H.sleep(100)
    CanvasRenderingContext2D.prototype.fillText = fillText
    const cs = getComputedStyle(host)
    const arrow = container.querySelector('.klinecharts-pro-drawing-bar .icon-arrow') as HTMLElement
    return {
      hostFont: [cs.fontFamily, cs.fontWeight, cs.textTransform],
      loaded: document.fonts.check('14px "klinecharts-pro-icons"'),
      iconDraws: [...fonts].filter(f => f.includes('klinecharts-pro-icons')).length,
      anyIcomoon: [...fonts].some(f => f.includes('icomoon')),
      arrow: [arrow.offsetWidth, arrow.offsetHeight],
      loadIcon: container.querySelectorAll('.klinecharts-pro-load-icon').length
    }
  })
  expect(state.hostFont).toEqual(['Georgia, serif', '700', 'uppercase'])
  expect(state.loaded).toBe(true)
  expect(state.iconDraws).toBeGreaterThan(0)
  expect(state.anyIcomoon).toBe(false)
  expect(state.arrow).toEqual([10, 32])
  expect(state.loadIcon).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: hover is a neutral wash, distinct from selected, and keeps the text colour`, async ({ page, kc }) => {
    await openHarness(page, kc)
    await page.evaluate(async (theme) => {
      const { H } = window as any
      const { pro } = H.mount({ id: 'hov', chart: { theme } })
      await H.ready(pro)
    }, theme)
    const bar = page.locator('#hov .klinecharts-pro-period-bar')
    const selected = bar.locator('.period.selected')
    const other = bar.locator('.period:not(.selected)').first()
    const tools = bar.locator('.tools').filter({ hasText: 'Indicator' })
    const look = async (l: typeof other): Promise<{ bg: string, color: string }> =>
      await l.evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }))
    // The bar fades its background over 0.2s; with transitions off, the
    // computed style is the end state as soon as :hover applies (no sleeps).
    await page.addStyleTag({ content: '#hov *, #hov *::before, #hov *::after { transition: none !important; }' })
    const restOther = await look(other)
    const restTools = await look(tools)
    const restSelected = await look(selected)
    // Real pointer hover (CDP input), so :hover applies.
    await other.hover()
    const hoverOther = await look(other)
    await tools.hover()
    const hoverTools = await look(tools)
    await selected.hover()
    const hoverSelected = await look(selected)
    expect(hoverOther.bg).not.toBe(restOther.bg)
    expect(hoverOther.bg).not.toBe(restSelected.bg)
    expect(hoverOther.color).toBe(restOther.color)
    expect(hoverTools.color).toBe(restTools.color)
    expect(hoverTools.bg).toBe(hoverOther.bg)
    expect(hoverSelected.bg).toBe(restSelected.bg)
    // The neutral wash: no blue cast.
    const [r, g, b] = hoverOther.bg.match(/[\d.]+/g)!.map(Number)
    expect(b - Math.min(r, g)).toBeLessThan(60)
  })
}

test('selected text and control borders are derived from the host tokens', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.className = 'chart'
    container.style.cssText = '--klinecharts-pro-primary-color: #1414B0; --klinecharts-pro-text-color: #10131A; --klinecharts-pro-text-second-color: #5B6170'
    document.getElementById('charts')!.appendChild(container)
    const { pro } = H.mount({ chart: { theme: 'light', container } })
    await H.ready(pro)
    const selected = container.querySelector('.klinecharts-pro-period-bar .period.selected') as HTMLElement
    const probe = document.createElement('span')
    probe.style.color = 'color-mix(in srgb, #1414B0 70%, #10131A)'
    container.appendChild(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    // Controls in the Settings modal take their borders from text-second.
    ;([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes('Setting'))?.click()
    await H.sleep(50)
    const off = container.querySelector('.klinecharts-pro-switch.turn-off') as HTMLElement
    const select = container.querySelector('.klinecharts-pro-select .selector-container') as HTMLElement
    const plain = H.mount({ chart: { theme: 'light' } })
    await H.ready(plain.pro)
    const plainSelected = plain.container.querySelector('.klinecharts-pro-period-bar .period.selected') as HTMLElement
    return {
      selected: getComputedStyle(selected).color,
      expected,
      plainSelected: getComputedStyle(plainSelected).color,
      offTrack: [getComputedStyle(off).backgroundColor, getComputedStyle(off).boxShadow],
      offThumb: getComputedStyle(off.querySelector('.thumb') as HTMLElement).backgroundColor,
      selectBorder: getComputedStyle(select).borderTopColor
    }
  })
  expect(state.selected).toBe(state.expected)
  // Defaults: the accent pulled toward the text colour, not the accent itself.
  expect(state.plainSelected).not.toBe('rgb(41, 98, 255)')
  expect(state.offTrack[0]).toBe('rgba(0, 0, 0, 0)')
  expect(state.offTrack[1]).toContain('rgb(91, 97, 112)')
  expect(state.offThumb).toBe('rgb(91, 97, 112)')
  expect(state.selectBorder).toBe('rgb(91, 97, 112)')
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: every floating surface has a border and takes its shadow and radius from the tokens`, async ({ page, kc }) => {
    await openHarness(page, kc)
    const state = await page.evaluate(async (theme) => {
      const { H } = window as any
      const { pro, container } = H.mount({ chart: { theme, symbol: { ticker: 'S', pricePrecision: 2, priceCurrency: 'usdt' } } })
      await H.ready(pro)
      const q = (sel: string): HTMLElement | null => container.querySelector(sel)
      const click = (el: Element | null | undefined): void => { (el as HTMLElement | null)?.click() }
      const tools = (label: string): HTMLElement | undefined =>
        ([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes(label))
      // What each token resolves to on this chart.
      const probe = document.createElement('div')
      container.appendChild(probe)
      const token = (prop: string, name: string): string => {
        probe.style.setProperty(prop, `var(--klinecharts-pro-${name})`)
        const value = getComputedStyle(probe).getPropertyValue(prop)
        probe.style.removeProperty(prop)
        return value
      }
      const expected = {
        border: token('border-top-color', 'popover-border-color'),
        radius: { sm: token('border-top-left-radius', 'radius-sm'), lg: token('border-top-left-radius', 'radius-lg') },
        shadow: { bar: token('box-shadow', 'shadow-bar'), menu: token('box-shadow', 'shadow-menu'), dialog: token('box-shadow', 'shadow-dialog') }
      }
      probe.remove()
      const look = (el: HTMLElement | null): unknown => {
        if (el === null) return null
        const cs = getComputedStyle(el)
        return { width: parseFloat(cs.borderTopWidth), border: cs.borderTopColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow }
      }
      const out: Record<string, unknown> = {}
      out.priceUnit = look(q('.klinecharts-pro-price-unit'))
      // The drawing toolbar: draw a line from the rail (it opens selected), then its colour popover.
      const canvasHost = q('.klinecharts-pro-widget > div') as HTMLElement
      const fire = (type: string, x: number, y: number): void => {
        canvasHost.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window }))
      }
      click(q('.klinecharts-pro-drawing-bar .item .icon-overlay-btn'))
      const box = canvasHost.getBoundingClientRect()
      const [x, y] = [box.left + 300, box.top + 150]
      // Right after the first data klinecharts can miss the placing click, so
      // click until the toolbar opens; 650 ms apart, since two mouseups within
      // 500 ms are a double-click. (Drawing itself is drawing-editor.spec's job.)
      for (let i = 0; i < 6 && q('.klinecharts-pro-drawing-toolbar') === null; i++) {
        fire('mouseenter', x, y)
        fire('mousemove', x, y)
        canvasHost.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }))
        fire('mousedown', x, y)
        fire('mouseup', x, y)
        await H.sleep(650)
      }
      out.drawingToolbar = look(q('.klinecharts-pro-drawing-toolbar'))
      click(q('.klinecharts-pro-drawing-toolbar button[aria-label="Line color"]'))
      await H.sleep(50)
      out.toolbarPopover = look(q('.klinecharts-pro-drawing-toolbar .tb-popover'))
      for (let i = 0; i < 2; i++) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await H.sleep(30)
      click(q('.klinecharts-pro-period-bar .chart-type'))
      await H.sleep(30)
      out.chartTypeMenu = look(q('.chart-type-menu'))
      click(q('.klinecharts-pro-period-bar .chart-type'))
      click(q('.klinecharts-pro-drawing-bar .item .icon-arrow'))
      await H.sleep(30)
      out.flyout = look(q('.klinecharts-pro-drawing-bar-flyout'))
      click(q('.klinecharts-pro-drawing-bar .item .icon-arrow'))
      click(tools('Replay'))
      await H.sleep(30)
      out.replayBar = look(q('.klinecharts-pro-replay-bar'))
      click(tools('Replay'))
      click(tools('Setting'))
      await H.sleep(30)
      out.modal = look(q('.klinecharts-pro-modal .inner'))
      out.dropdown = look(q('.klinecharts-pro-modal .klinecharts-pro-select .drop-down-container'))
      return { expected, out }
    }, theme)
    const { expected, out } = state as any
    const want = (radius: 'sm' | 'lg', shadow: 'bar' | 'menu' | 'dialog'): unknown =>
      ({ width: 1, border: expected.border, radius: expected.radius[radius], shadow: expected.shadow[shadow] })
    expect(out.priceUnit).toEqual(want('sm', 'bar'))
    expect(out.drawingToolbar).toEqual(want('lg', 'bar'))
    expect(out.toolbarPopover).toEqual(want('sm', 'menu'))
    expect(out.chartTypeMenu).toEqual(want('sm', 'menu'))
    expect(out.flyout).toEqual(want('sm', 'menu'))
    expect(out.replayBar).toEqual(want('lg', 'bar'))
    expect(out.modal).toEqual(want('lg', 'dialog'))
    expect(out.dropdown).toEqual(want('sm', 'menu'))
    expect(new Set([expected.shadow.bar, expected.shadow.menu, expected.shadow.dialog]).size).toBe(3)
  })
}

test('the chart is its own stacking context: a sticky host header stays on top of its modal, flyout and loading layer', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const header = document.createElement('div')
    header.id = 'sticky'
    header.style.cssText = 'position: sticky; top: 0; z-index: 50; height: 60px; background: #333'
    header.innerHTML = '<a id="nav" href="#">nav</a>'
    document.body.insertBefore(header, document.getElementById('charts'))
    document.getElementById('charts')!.style.paddingBottom = '1200px'
    // A feed that never answers, so the loading layer stays up.
    const feed = H.makeDatafeed()
    const pending = { ...feed.datafeed, getHistoryKLineData: () => new Promise(() => {}) }
    const loading = H.mount({ chart: { datafeed: pending } })
    const { pro, container } = H.mount()
    await H.ready(pro)
    const hit = (x: number, y: number): string => {
      const el = document.elementFromPoint(x, y)
      return el === null ? 'null' : (el.closest('#sticky') !== null ? 'header' : (el.closest('.klinecharts-pro') !== null ? 'chart' : el.tagName))
    }
    const out: Record<string, string> = {}
    // Loading layer: scroll its chart under the header.
    window.scrollTo(0, (loading.container as HTMLElement).getBoundingClientRect().top + window.scrollY - 30)
    out.loadingUp = String(loading.container.querySelector('.klinecharts-pro-loading') !== null)
    out.overLoading = hit(300, 30)
    // Modal.
    window.scrollTo(0, (container as HTMLElement).getBoundingClientRect().top + window.scrollY + 20)
    ;([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes('Setting'))?.click()
    await H.sleep(30)
    out.overModal = hit(300, 30)
    const nav = (document.getElementById('nav') as HTMLElement).getBoundingClientRect()
    out.navOverModal = document.elementFromPoint(nav.left + nav.width / 2, nav.top + nav.height / 2)?.id ?? 'null'
    const r = (container as HTMLElement).getBoundingClientRect()
    out.modalCoversChart = String(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.klinecharts-pro-modal') !== null)
    // A fixed host layer later in the DOM (a portal) at z 50 wins over the modal.
    const portal = document.createElement('div')
    portal.style.cssText = `position: fixed; left: ${r.left + 10}px; top: ${r.top + r.height / 2 - 20}px; width: 40px; height: 40px; z-index: 50; background: red`
    portal.id = 'portal'
    document.body.appendChild(portal)
    out.portal = document.elementFromPoint(r.left + 30, r.top + r.height / 2)?.id ?? 'null'
    portal.remove()
    ;(container.querySelector('.klinecharts-pro-modal .close-icon') as HTMLElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await H.sleep(30)
    // Rail flyout, scrolled so its top is under the header.
    ;(container.querySelector('.klinecharts-pro-drawing-bar .item .icon-arrow') as HTMLElement).click()
    await H.sleep(30)
    const list = container.querySelector('.klinecharts-pro-drawing-bar-flyout') as HTMLElement
    const lr = list.getBoundingClientRect()
    window.scrollBy(0, lr.top - 20)
    const lr2 = list.getBoundingClientRect()
    out.overFlyout = hit(lr2.left + 20, 30)
    out.flyoutOverCanvas = String(document.elementFromPoint(lr2.left + 20, lr2.bottom - 10)?.closest('.klinecharts-pro-drawing-bar-flyout') !== null)
    // The engine's own root (SC-075) is the stacking context.
    out.isolation = getComputedStyle(container.querySelector('.klinecharts-pro-root') as HTMLElement).isolation
    return out
  })
  expect(state).toEqual({
    loadingUp: 'true',
    overLoading: 'header',
    overModal: 'header',
    navOverModal: 'nav',
    modalCoversChart: 'true',
    portal: 'portal',
    overFlyout: 'header',
    flyoutOverCanvas: 'true',
    isolation: 'isolate'
  })
})

test('color-scheme follows the chart theme, not the host page; the lists keep their own scrollbar', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    document.documentElement.style.colorScheme = 'dark'
    const { pro, container } = H.mount({ chart: { theme: 'light' } })
    await H.ready(pro)
    const scheme = (): string[] => [
      getComputedStyle(container).colorScheme,
      getComputedStyle(container.querySelector('.klinecharts-pro-drawing-bar') as HTMLElement).colorScheme
    ]
    const light = scheme()
    pro.setTheme('dark')
    const dark = scheme()
    // Dropdown scrollbar: thin, tinted; the indicator list keeps its 8px thumb.
    ;([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes('Setting'))?.click()
    await H.sleep(30)
    const dropdownStyle = getComputedStyle(container.querySelector('.klinecharts-pro-select .drop-down-container') as HTMLElement)
    // Read now: a computed style object is live and empties once the modal closes.
    const dropdown = [dropdownStyle.colorScheme, dropdownStyle.scrollbarWidth]
    ;(container.querySelector('.klinecharts-pro-modal .close-icon') as HTMLElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await H.sleep(30)
    ;([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes('Indicator'))?.click()
    await H.sleep(30)
    const list = container.querySelector('.klinecharts-pro-list') as HTMLElement
    return {
      light,
      dark,
      dropdown,
      // Headless Chrome hides scrollbars (no gutter to measure), so check the
      // cause instead: scrollbar-color and -width inherit, and a non-auto
      // value would switch off the list's ::-webkit-scrollbar 8px thumb.
      list: [getComputedStyle(list).scrollbarColor, getComputedStyle(list).scrollbarWidth],
      listScrolls: list.scrollHeight > list.clientHeight
    }
  })
  expect(state.light).toEqual(['light', 'light'])
  expect(state.dark).toEqual(['dark', 'dark'])
  expect(state.dropdown).toEqual(['dark', 'thin'])
  expect(state.listScrolls).toBe(true)
  expect(state.list).toEqual(['auto', 'auto'])
})

test('buttons and inputs use the chart\'s font; text inputs have a text cursor and keep their size', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.className = 'chart'
    container.style.fontFamily = 'Georgia, serif'
    document.getElementById('charts')!.appendChild(container)
    const { pro } = H.mount({ chart: { container } })
    await H.ready(pro)
    const tools = (label: string): HTMLElement | undefined =>
      ([...container.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes(label))
    const close = async (): Promise<void> => {
      ;(container.querySelector('.klinecharts-pro-modal .close-icon') as HTMLElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await H.sleep(30)
    }
    const root = getComputedStyle(container).fontFamily
    tools('Setting')?.click()
    await H.sleep(30)
    const settingButton = getComputedStyle(container.querySelector('.klinecharts-pro-button') as HTMLElement).fontFamily
    await close()
    tools('Timezone')?.click()
    await H.sleep(30)
    // The timezone picker is a popover (search input + listbox), not a modal
    // with a Confirm button (SC-117): check the search input's font instead.
    const timezoneButton = getComputedStyle(container.querySelector('.klinecharts-pro-timezone-picker .search') as HTMLElement).fontFamily
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await H.sleep(30)
    ;(container.querySelector('.klinecharts-pro-period-bar .symbol') as HTMLElement).click()
    await H.sleep(30)
    const search = getComputedStyle(container.querySelector('.klinecharts-pro-input .value') as HTMLElement)
    return { root, settingButton, timezoneButton, search: [search.fontFamily, search.cursor, search.fontSize] }
  })
  expect(state.root).toBe('Georgia, serif')
  expect(state.settingButton).toBe(state.root)
  expect(state.timezoneButton).toBe(state.root)
  expect(state.search).toEqual([state.root, 'text', '16px'])
})

test('chrome text uses the type scale: token sizes, two weights, one size per top-bar row', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    // A host that restyles the bar the way SupWallet's vibe-studio does.
    const style = document.createElement('style')
    style.textContent = '#host-tools.klinecharts-pro { font-size: 12px } #host-tools .klinecharts-pro-period-bar .tools { font-size: 11px }'
    document.head.appendChild(style)
    const { pro, container } = H.mount({ chart: { symbol: { ticker: 'S', pricePrecision: 2, priceCurrency: 'usdt' } } })
    await H.ready(pro)
    const host = H.mount({ id: 'host-tools' })
    await H.ready(host.pro)
    const seen: Array<[string, string, string]> = []
    const collect = (): void => {
      for (const el of container.querySelectorAll('*')) {
        const own = [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
        if (!own || el.closest('.klinecharts-pro-replay-bar .glyph') !== null) continue
        const cs = getComputedStyle(el)
        if (cs.display === 'none') continue
        seen.push([`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`, cs.fontSize, cs.fontWeight])
      }
    }
    const tools = (c: HTMLElement, label: string): HTMLElement | undefined =>
      ([...c.querySelectorAll('.klinecharts-pro-period-bar .tools')] as HTMLElement[]).find(e => e.textContent?.includes(label))
    const close = async (): Promise<void> => {
      ;(container.querySelector('.klinecharts-pro-modal .close-icon') as HTMLElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await H.sleep(30)
    }
    collect()
    ;(container.querySelector('.klinecharts-pro-period-bar .chart-type') as HTMLElement).click()
    await H.sleep(30)
    collect()
    ;(container.querySelector('.klinecharts-pro-period-bar .chart-type') as HTMLElement).click()
    for (const label of ['Setting', 'Indicator', 'Timezone']) {
      tools(container, label)?.click()
      await H.sleep(30)
      collect()
      await close()
    }
    ;(container.querySelector('.klinecharts-pro-period-bar .symbol') as HTMLElement).click()
    await H.sleep(30)
    collect()
    await close()
    tools(container, 'Replay')?.click()
    await H.sleep(30)
    collect()
    // SC-NEXT #4's Indicators count badge (.badge) is deliberately smaller
    // than its label — a count pill reads as a pill precisely because it is
    // not the same size as the text next to it, the same way every other
    // badge/count UI works — so it is excluded from this "one label size per
    // row" check on purpose, not because the invariant stopped mattering for
    // actual labels.
    const rowSizes = (c: HTMLElement): string[] => [...new Set(
      ([...c.querySelectorAll('.klinecharts-pro-period-bar .period, .klinecharts-pro-period-bar .tools span')] as HTMLElement[])
        .filter(e => !e.classList.contains('badge'))
        .map(e => getComputedStyle(e).fontSize))]
    return { seen, row: rowSizes(container), hostTools: [...new Set(([...host.container.querySelectorAll('.klinecharts-pro-period-bar .tools span')] as HTMLElement[]).map(e => getComputedStyle(e).fontSize))] }
  })
  const sizes = new Set(['11px', '12px', '13px', '14px', '16px', '18px'])
  expect(state.seen.length).toBeGreaterThan(40)
  expect(state.seen.filter(([, size]) => !sizes.has(size))).toEqual([])
  expect(state.seen.filter(([, , weight]) => weight !== '400' && weight !== '600')).toEqual([])
  expect(state.row).toEqual(['14px'])
  // The chart-type label follows the host's .tools size like the other labels.
  expect(state.hostTools).toEqual(['11px'])
})

test('rail flyout labels use the text colour, including a host\'s', async ({ page, kc }) => {
  await openHarness(page, kc)
  const colours = await page.evaluate(async () => {
    const { H } = window as any
    const read = async (container: HTMLElement): Promise<string> => {
      ;(container.querySelector('.klinecharts-pro-drawing-bar .item .icon-arrow') as HTMLElement).click()
      await H.sleep(30)
      // An unselected row: the current tool's row is marked (SC-060).
      return getComputedStyle(container.querySelector('.klinecharts-pro-drawing-bar-flyout li:not(.selected)') as HTMLElement).color
    }
    const plain = H.mount({ chart: { theme: 'light' } })
    await H.ready(plain.pro)
    const container = document.createElement('div')
    container.className = 'chart'
    container.style.cssText = '--klinecharts-pro-text-color: #aa0000; --klinecharts-pro-text-second-color: #0000aa'
    document.getElementById('charts')!.appendChild(container)
    const host = H.mount({ chart: { theme: 'light', container } })
    await H.ready(host.pro)
    return { plain: await read(plain.container), host: await read(container) }
  })
  expect(colours).toEqual({ plain: 'rgb(5, 20, 65)', host: 'rgb(170, 0, 0)' })
})
