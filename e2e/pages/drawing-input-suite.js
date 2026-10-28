// Behaviour checks for this batch's own findings (rail rebuild-on-pick,
// hotkeys, Esc-cancel, stay mode, quick measure, magnet, built-in hit
// tolerance, brush pane/create-once/selection, cursor feedback). Mirrors the
// driving style of drawing-editor-suite.js: synthetic pointer/mouse/keyboard
// events and state assertions, never "no error thrown". A synthetic
// KeyboardEvent is fine here because nothing checked below relies on a
// browser default action for the key itself (unlike Enter/Space activating a
// focused <button>, which needs real trusted input — see
// tests/drawing-input-keyboard.spec.ts for that one claim).

export async function run () {
  const { H } = window
  const results = []
  const check = (step, ok, detail) => { results.push({ step, ok: !!ok, detail: detail === undefined ? '' : String(detail) }) }
  const { pro: chartPro } = H.mount({ id: 'chart' })

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const chart = () => chartPro.getChart()
  const kc = () => document.querySelector('.klinecharts-pro-widget > div')
  const store = () => chart().getChartStore().getOverlayStore()
  const allOverlays = () => store().getInstances()
  const box = () => kc().getBoundingClientRect()
  const P = (x, y) => ({ x: box().left + x, y: box().top + y })
  function fire (target, type, x, y, button = 0) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons: button === 2 ? 2 : 1, view: window }))
  }
  async function clickAt (pt, button = 0) {
    const t = kc()
    fire(t, 'mouseenter', pt.x, pt.y)
    fire(t, 'mousemove', pt.x, pt.y)
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button, pointerId: 1 }))
    fire(t, 'mousedown', pt.x, pt.y, button)
    if (button === 0) fire(t, 'mouseup', pt.x, pt.y, button)
    await sleep(650) // klinecharts counts a 2nd mouseup within 500ms as a double-click
  }
  const key = (k, opts = {}, target = document.body) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: opts.code ?? k, altKey: !!opts.alt, shiftKey: !!opts.shift, ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, bubbles: true, cancelable: true }))
  }
  const railItems = () => [...document.querySelectorAll('.klinecharts-pro-drawing-bar .item')]
  const newUserIds = before => allOverlays().filter(o => !before.includes(o.id)).map(o => o.id)

  // Drag a stroke over the chart with real pointer events (for the brush).
  async function dragStroke (points) {
    const t = kc()
    const first = points[0]
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: first.x, clientY: first.y, button: 0, pointerId: 9, isPrimary: true }))
    for (const p of points.slice(1)) {
      t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, pointerId: 9, isPrimary: true }))
      await sleep(5)
    }
    const last = points[points.length - 1]
    t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: last.x, clientY: last.y, button: 0, pointerId: 9, isPrimary: true }))
  }

  async function scenario () {
    await H.ready(chartPro)
    const c = chart()
    check('chart ready', !!c && c.getDataList().length > 50, c && c.getDataList().length)

    // 1. Rail rebuild-on-pick (SC-011): picking a flyout variant must not
    // rebuild the rail — the item stays connected, focus stays on it, and
    // the icon markup actually changes (catches a frozen <Icon>).
    const item0 = railItems()[0]
    const mainBtn0 = item0.querySelector('.icon-overlay-btn')
    const beforeHtml = mainBtn0.innerHTML
    item0.querySelector('.icon-arrow').click()
    await sleep(50)
    const flyout = document.querySelector('.klinecharts-pro-drawing-bar-flyout')
    check('flyout opens on arrow click', !!flyout)
    const rayLineRow = [...(flyout?.querySelectorAll('li') ?? [])].find(li => li.textContent.includes('Ray'))
    rayLineRow?.click()
    await sleep(50)
    check('rail item stays connected after a flyout pick', item0.isConnected)
    check('rail icon markup actually changed (not frozen)', mainBtn0.innerHTML !== beforeHtml, [beforeHtml.length, mainBtn0.innerHTML.length])
    check('flyout closed after picking', !document.querySelector('.klinecharts-pro-drawing-bar-flyout'))

    // Reset to a known tool (segment) via the flyout for the rest of the suite.
    item0.querySelector('.icon-arrow').click()
    await sleep(50)
    const segmentRow = [...document.querySelectorAll('.klinecharts-pro-drawing-bar-flyout li')].find(li => li.textContent.trim() === 'Trend Line')
    segmentRow?.click()
    await sleep(50)
    check('"Trend Line" is the relabelled segment tool (SC-118)', !!segmentRow)

    // 2. Hotkey Alt+H arms horizontalStraightLine (SC-095); one click places it.
    let before = allOverlays().map(o => o.id)
    kc().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })) // press in the chart, so the chart owns the key
    key('h', { code: 'KeyH', alt: true })
    // Let klinecharts attach the armed overlay before the synthetic click.
    // Under the full browser matrix the immediate same-task click can race
    // its next-frame overlay setup; a person cannot click within that frame.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    check('Alt+H arms the horizontal line tool', store().getProgressInstanceInfo()?.instance?.name === 'horizontalStraightLine')
    await clickAt(P(300, 150))
    let hotkeyLine = newUserIds(before)[0]
    check('Alt+H arms horizontalStraightLine and places it on one click', !!hotkeyLine && c.getOverlayById(hotkeyLine).name === 'horizontalStraightLine', JSON.stringify({
      hotkeyLine,
      newIds: newUserIds(before),
      progress: store().getProgressInstanceInfo()?.instance?.name,
      flyoutOpen: !!document.querySelector('.klinecharts-pro-drawing-bar-flyout'),
      activeTag: document.activeElement?.tagName
    }))
    check('Ctrl+Alt+H (AltGr-like) does not arm anything', (() => {
      const b2 = allOverlays().map(o => o.id)
      key('h', { code: 'KeyH', alt: true, ctrl: true })
      return newUserIds(b2).length === 0
    })())
    key('Delete'); await sleep(50)

    // 3. Esc cancels an armed tool, leaving no progress instance (SC-094).
    before = allOverlays().map(o => o.id)
    key('h', { code: 'KeyH', alt: true })
    key('Escape')
    await sleep(20)
    check('Escape after arming leaves no progress instance', store().getProgressInstanceInfo() == null || store().getProgressInstanceInfo().instance == null)
    await clickAt(P(300, 200))
    check('Escape actually cancelled: the click after it starts nothing', newUserIds(before).length === 0, newUserIds(before))

    // 4. Re-clicking the armed tool disarms it (SC-094).
    railItems()[0].querySelector('.icon-overlay-btn').click(); await sleep(20)
    check('rail button shows armed (aria-pressed)', railItems()[0].querySelector('.icon-overlay-btn').getAttribute('aria-pressed') === 'true')
    railItems()[0].querySelector('.icon-overlay-btn').click(); await sleep(20)
    check('clicking the armed tool again disarms it', railItems()[0].querySelector('.icon-overlay-btn').getAttribute('aria-pressed') === 'false')
    check('no progress instance left after disarming', store().getProgressInstanceInfo() == null || store().getProgressInstanceInfo().instance == null)

    // 5. Stay mode: 3 clicks give 3 finished lines with the tool still armed (SC-094).
    chartPro.setDrawingStayMode(true)
    check('getDrawingStayMode reflects setDrawingStayMode', chartPro.getDrawingStayMode() === true)
    before = allOverlays().map(o => o.id)
    chartPro.armTool('segment')
    await clickAt(P(200, 400)); await clickAt(P(250, 420))
    await sleep(700)
    await clickAt(P(300, 400)); await clickAt(P(350, 420))
    await sleep(700)
    await clickAt(P(400, 400)); await clickAt(P(450, 420))
    await sleep(200)
    const stayLines = newUserIds(before)
    check('stay mode: 3 completed segments from 3 pairs of clicks', stayLines.length === 3, stayLines.map(id => c.getOverlayById(id)?.currentStep))
    chartPro.cancelTool()
    chartPro.setDrawingStayMode(false)
    stayLines.forEach(id => { try { c.removeOverlay({ id }) } catch (e) {} })

    // 6. Quick measure (Shift+click, SC-125): ephemeral, outside the drawing group.
    before = allOverlays().map(o => o.id)
    const p1 = P(500, 100), p2 = P(600, 200)
    const t = kc()
    fire(t, 'mouseenter', p1.x, p1.y)
    fire(t, 'mousemove', p1.x, p1.y)
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: p1.x, clientY: p1.y, button: 0, pointerId: 2, shiftKey: true }))
    t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p1.x, clientY: p1.y, button: 0, buttons: 1, shiftKey: true, view: window }))
    t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: p1.x, clientY: p1.y, button: 0, shiftKey: true, view: window }))
    await sleep(650)
    await clickAt(p2)
    const measureId = newUserIds(before)[0]
    check('shift+click places a priceDateRange outside the drawing group', !!measureId && c.getOverlayById(measureId).name === 'priceDateRange' && c.getOverlayById(measureId).groupId !== 'drawing_tools', measureId && c.getOverlayById(measureId))
    check('the drawing-bar remove-all does not remove the quick measure', (() => {
      const removeItem = railItems()[railItems().length - 1]
      removeItem.querySelector('.icon-overlay-btn').click()
      return !!c.getOverlayById(measureId)
    })())
    // A third press removes it.
    kc().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: p1.x, clientY: p1.y, button: 0, pointerId: 3 }))
    await sleep(50)
    check('the next press removes the finished quick measure', !c.getOverlayById(measureId))

    // 7. Magnet (SC-103): weak magnet snaps the point being placed (klinecharts
    // tracks it live via onDrawing while the cursor moves before the
    // confirming click) within sensitivity below the low. A 1-point tool's
    // very first point has no live tracking to snap, so this uses a 2-point
    // tool (segment) and snaps its second point.
    const dl = c.getDataList()
    const bar = dl[dl.length - 30]
    const barIdx = dl.length - 30
    const lowPx = c.convertToPixel({ dataIndex: barIdx, value: bar.low }, { paneId: 'candle_pane' })
    // convertToPixel's y is relative to the candle pane's own canvas, not the
    // widget container box() is measured against — it needs box().top added,
    // the same as box().left is added to its x, or the synthetic mousemove
    // below lands tens of price units away from the bar and nothing snaps
    // (this cost a debugging pass: real Playwright mouse input reproduced the
    // exact same miss, which is what proved the coordinate math wrong instead
    // of the snap logic, already covered by magnet.test.ts's unit tests).
    const magnetY = box().top + lowPx.y
    // The magnet item is the one right after the tool groups (index 10 of 14, i.e. after the 10 groups).
    const magnetBtn = railItems()[10].querySelector('.icon-overlay-btn')
    magnetBtn.click(); await sleep(20)
    check('weak magnet armed via the rail', magnetBtn.getAttribute('aria-pressed') === 'true')
    before = allOverlays().map(o => o.id)
    chartPro.armTool('segment')
    await clickAt(P(150, 350)) // point 1, away from the target bar
    const magnetTarget = { x: box().left + (lowPx.x ?? 300), y: magnetY + 4 }
    fire(kc(), 'mousemove', magnetTarget.x, magnetTarget.y) // live-tracks point 2 (onDrawing)
    await sleep(30)
    await clickAt(magnetTarget) // confirms point 2 where the mouse already is
    const magnetLine = newUserIds(before)[0]
    const snappedValue = magnetLine && c.getOverlayById(magnetLine).points[1]?.value
    // Exact equality is unreachable: the snap goes through a pixel round-trip
    // (value -> pixel -> nearest OHLC pixel -> value back), and klinecharts
    // rounds pixel coordinates, so allow up to ~3 price-per-pixel of residual
    // (measured directly via two already-known OHLC/pixel pairs, not assumed)
    // while still rejecting "did not snap at all" (the unsnapped miss here is
    // ~8-12 price units, an order above this). convertFromPixel is avoided
    // here: passing it a bare (non-array) point throws on klinecharts 9.7.2.
    const highPx = c.convertToPixel({ dataIndex: barIdx, value: bar.high }, { paneId: 'candle_pane' })
    const priceDeltaPerPx = bar.high !== bar.low && highPx.y !== lowPx.y
      ? Math.abs(bar.high - bar.low) / Math.abs(highPx.y - lowPx.y)
      : 0.01
    const snapTolerance = Math.max(priceDeltaPerPx * 3, 1e-6)
    check('weak magnet: 4px below the low snaps point 2 to the low', !!magnetLine && typeof snappedValue === 'number' && Math.abs(snappedValue - bar.low) <= snapTolerance, [snappedValue, bar.low, snapTolerance])
    if (magnetLine) c.removeOverlay({ id: magnetLine })
    magnetBtn.click(); await sleep(20) // back to normal
    check('magnet back to normal', magnetBtn.getAttribute('aria-pressed') === 'false')
    // klinecharts 9.7.2 was seen throwing an uncaught, unrelated-looking error
    // asynchronously (surfacing during a later section, not this one) when
    // this section's two placements ran back to back with no settle time —
    // never on 9.8.12, and not reproducible once this wait was added. Giving
    // its internal drawing state a beat to settle before the next section
    // starts avoids it; see the PR body for what was and was not root-caused.
    await sleep(300)

    // 8. Built-in line hit tolerance (SC-100): a drawing-group segment is
    // selectable at MIN_HIT_TOLERANCE - 0.5px, a group-less host line still
    // misses at 3.5px (klinecharts' own ~2px band).
    before = allOverlays().map(o => o.id)
    chartPro.armTool('segment')
    await clickAt(P(200, 300)); await clickAt(P(500, 300))
    const hitLineId = newUserIds(before)[0]
    store().setClickInstanceInfo({ paneId: 'candle_pane', instance: null, figureType: 0, figureKey: '', figureIndex: -1, attrsIndex: -1 }, {})
    await clickAt({ x: box().left + 350, y: box().top + 300 + 3.5 })
    check('drawing-group segment selected at 3.5px (> klinecharts\' own ~2px band)', store().getClickInstanceInfo()?.instance?.id === hitLineId)
    store().setClickInstanceInfo({ paneId: 'candle_pane', instance: null, figureType: 0, figureKey: '', figureIndex: -1, attrsIndex: -1 }, {})
    const hostLineId = c.createOverlay({ name: 'segment', points: [{ dataIndex: dl.length - 60, value: bar.low - 5 }, { dataIndex: dl.length - 40, value: bar.low - 5 }] })
    await sleep(50)
    const hostPx = c.convertToPixel({ dataIndex: dl.length - 50, value: bar.low - 5 }, { paneId: 'candle_pane' })
    await clickAt({ x: hostPx.x, y: hostPx.y + 3.5 })
    check('a group-less host segment still misses at 3.5px (unaffected)', store().getClickInstanceInfo()?.instance?.id !== hostLineId)
    c.removeOverlay({ id: hostLineId })
    if (hitLineId) c.removeOverlay({ id: hitLineId })

    // 9. Freehand brush: create-once (no per-move rebuild) and pane resolution (SC-009).
    before = allOverlays().map(o => o.id)
    const brushItem = railItems()[8]
    brushItem.querySelector('.icon-overlay-btn').click()
    await sleep(50)
    const created0 = []
    const removed0 = []
    const obs = new MutationObserver(muts => {})
    let createCalls = 0, removeCalls = 0
    const origCreate = c.createOverlay.bind(c)
    const origRemove = c.removeOverlay.bind(c)
    c.createOverlay = (...args) => { createCalls++; return origCreate(...args) }
    c.removeOverlay = (...args) => { removeCalls++; return origRemove(...args) }
    await dragStroke([P(150, 500), P(170, 480), P(190, 460), P(210, 440), P(230, 420)])
    c.createOverlay = origCreate
    c.removeOverlay = origRemove
    const strokeId = newUserIds(before)[0]
    check('brush: exactly one createOverlay, zero removeOverlay for a stroke', createCalls === 1 && removeCalls === 0, [createCalls, removeCalls])
    check('brush: stroke selected after finishing', !!strokeId && store().getClickInstanceInfo()?.instance?.id === strokeId, strokeId)
    if (strokeId) c.removeOverlay({ id: strokeId })
    check('klinecharts version', true, H.kcVersion)
  }

  try {
    await scenario()
  } catch (e) {
    check('driver exception', false, String((e && e.stack) || e))
  }
  return results
}
