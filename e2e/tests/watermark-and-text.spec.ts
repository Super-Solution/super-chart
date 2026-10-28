import { test, expect, openHarness } from './fixtures'

// SC-050 (watermark default and ownership) and SC-032 (no HTML injection).

test('no default watermark: the element is kept, empty, and a host can style it', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const style = document.createElement('style')
    style.textContent = '.klinecharts-pro-watermark { background-image: url("data:image/gif;base64,R0lGODlhAQABAAAAACw=") }'
    document.head.appendChild(style)
    const { pro, container } = H.mount()
    await H.ready(pro)
    const marks = [...container.querySelectorAll('.klinecharts-pro-watermark')] as HTMLElement[]
    return {
      count: marks.length,
      children: marks[0]?.childNodes.length,
      text: marks[0]?.textContent,
      logo: container.querySelectorAll('svg.logo').length,
      background: marks[0] ? getComputedStyle(marks[0]).backgroundImage : ''
    }
  })
  expect(state).toMatchObject({ count: 1, children: 0, text: '', logo: 0 })
  expect(state.background).toContain('url(')
})

test('two charts given the same watermark Node each keep one', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const shared = document.createElement('b')
    shared.className = 'host-mark'
    shared.textContent = 'HOST'
    const a = H.mount({ chart: { watermark: shared } })
    await H.ready(a.pro)
    const b = H.mount({ chart: { watermark: shared } })
    await H.ready(b.pro)
    const count = (el: HTMLElement): number => el.querySelectorAll('.klinecharts-pro-watermark .host-mark').length
    const both = [count(a.container), count(b.container)]
    const firstKeepsTheLiveNode = a.container.querySelector('.host-mark') === shared
    b.pro.dispose()
    const afterDisposeB = count(a.container)
    let calls = 0
    const factory = (): Node => { calls++; const n = document.createElement('i'); n.className = 'made'; return n }
    const c = H.mount({ chart: { watermark: factory } })
    await H.ready(c.pro)
    const d = H.mount({ chart: { watermark: factory } })
    await H.ready(d.pro)
    return { both, firstKeepsTheLiveNode, afterDisposeB, calls, made: [c.container.querySelectorAll('.made').length, d.container.querySelectorAll('.made').length] }
  })
  expect(state).toEqual({ both: [1, 1], firstKeepsTheLiveNode: true, afterDisposeB: 1, calls: 2, made: [1, 1] })
})

const WATERMARK_PAYLOAD = '<img src=x onerror="window.__xss = (window.__xss || 0) + 1">'
// Survives upper-casing: an uppercase numeric-entity payload.
const CURRENCY_PAYLOAD = '<IMG SRC=X ONERROR=&#X77;&#X69;&#X6E;&#X64;&#X6F;&#X77;.__XSS=1>'

test('a string watermark and priceCurrency are text, never HTML', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async ({ WATERMARK_PAYLOAD, CURRENCY_PAYLOAD }) => {
    const { H } = window as any
    const unit = (el: HTMLElement): HTMLElement => el.querySelector('.klinecharts-pro-price-unit') as HTMLElement
    const mark = (el: HTMLElement): HTMLElement => el.querySelector('.klinecharts-pro-watermark') as HTMLElement

    // 1. options: watermark and symbol.priceCurrency
    const a = H.mount({ chart: { watermark: WATERMARK_PAYLOAD, symbol: { ticker: 'A', pricePrecision: 2, priceCurrency: CURRENCY_PAYLOAD } } })
    await H.ready(a.pro)
    // 2. setSymbol
    const b = H.mount({ chart: { symbol: { ticker: 'B', pricePrecision: 2, priceCurrency: 'usdt' } } })
    await H.ready(b.pro)
    const plain = unit(b.container).textContent
    b.pro.setSymbol({ ticker: 'B2', pricePrecision: 2, priceCurrency: CURRENCY_PAYLOAD })
    // 3. a symbol picked in the symbol search
    const c = H.mount({ feed: { search: [{ ticker: 'C2', pricePrecision: 2, priceCurrency: CURRENCY_PAYLOAD }] } })
    await H.ready(c.pro)
    ;(c.container.querySelector('.klinecharts-pro-period-bar .symbol') as HTMLElement).click()
    let item: HTMLElement | null = null
    for (let i = 0; i < 40 && item === null; i++) { await H.sleep(50); item = c.container.querySelector('.klinecharts-pro-symbol-search-modal-list li') }
    item?.click()
    const d = H.mount({ chart: { watermark: '  Sup  ' } })
    await H.ready(d.pro)
    await H.sleep(500) // let any injected <img> fail to load and fire onerror
    return {
      xss: (window as any).__xss ?? (window as any).__XSS ?? null,
      imgs: [a, b, c].map(x => x.container.querySelectorAll('.klinecharts-pro-watermark img, .klinecharts-pro-price-unit img').length),
      watermarkText: mark(a.container).textContent,
      unitA: unit(a.container).textContent,
      unitB: unit(b.container).textContent,
      pickedFromSearch: item !== null && c.pro.getSymbol().ticker === 'C2',
      unitC: unit(c.container).textContent,
      plain,
      sup: mark(d.container).textContent
    }
  }, { WATERMARK_PAYLOAD, CURRENCY_PAYLOAD })
  expect(state.xss).toBeNull()
  expect(state.imgs).toEqual([0, 0, 0])
  expect(state.watermarkText).toBe(WATERMARK_PAYLOAD)
  expect(state.unitA).toBe(CURRENCY_PAYLOAD.toUpperCase())
  expect(state.unitB).toBe(CURRENCY_PAYLOAD.toUpperCase())
  expect(state.pickedFromSearch).toBe(true)
  expect(state.unitC).toBe(CURRENCY_PAYLOAD.toUpperCase())
  expect(state.plain).toBe('USDT')
  expect(state.sup).toBe('Sup')
})
