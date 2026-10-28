// The drawing-editor behaviour suite, ported from the scratch verify.html the
// drawing-editor PR was checked with (59 state checks, green on 9.1.1 and
// 9.8.12 before this port). It drives the chart with synthetic pointer and
// mouse events and asserts state: overlay ids, styles, lock/visible flags,
// toolbar DOM, klinecharts' click instance. Never pixels.
//
// Changes from the scratch copy: the chart comes from window.H (the built
// package, ESM or UMD, on the project's klinecharts), requestAnimationFrame is
// native (no virtual-time shim), 58 of the 59 checks are kept (its "no page
// errors" check is the spec's pageErrors assertion), and 2 were added at the
// end: drawing again, and a symbol switch closing the toolbar. 60 checks.

export async function run () {
  const { H } = window
  const LOCALE = 'en-US'
  window.prompt = () => 'Note text'
  const results = []
  const check = (step, ok, detail) => { results.push({ step, ok: !!ok, detail: detail === undefined ? '' : String(detail) }) }
  const { pro: chartPro } = H.mount({ id: 'chart' })

// ---------------------------------------------------------------- helpers
const sleep = ms => new Promise(r => setTimeout(r, ms))
const chart = () => chartPro.getChart()
const kc = () => document.querySelector('.klinecharts-pro-widget > div')
const toolbar = () => document.querySelector('.klinecharts-pro-drawing-toolbar')
const toolbarVisible = () => { const t = toolbar(); return !!t && getComputedStyle(t).visibility === 'visible' }
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
async function dragFrom (a, b) {
  const t = kc()
  fire(t, 'mouseenter', a.x, a.y)
  fire(t, 'mousemove', a.x, a.y)
  fire(t, 'mousedown', a.x, a.y)
  for (let i = 1; i <= 5; i++) fire(document.documentElement, 'mousemove', a.x + (b.x - a.x) * i / 5, a.y + (b.y - a.y) * i / 5)
  fire(document.documentElement, 'mouseup', b.x, b.y)
  await sleep(650)
}
const key = (k, target = document.body) => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) }
// Same, with modifier keys — for the Ctrl+Z/Ctrl+D/Ctrl+C/Ctrl+V shortcuts (SC-092, SC-109).
const keyMod = (k, mods, target = document.body) => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })) }
const btn = label => toolbar()?.querySelector(`button[aria-label="${label}"]`) ?? null
const btnStart = label => [...(toolbar()?.querySelectorAll('button') ?? [])].find(b => (b.getAttribute('aria-label') || '').startsWith(label)) ?? null
const railItems = () => [...document.querySelectorAll('.klinecharts-pro-drawing-bar .item')]
const hostSnapshot = ids => JSON.stringify(ids.map(id => { const o = chart().getOverlayById(id); return o && { styles: o.styles, lock: o.lock, visible: o.visible, mode: o.mode, points: o.points } }))
const newUserIds = before => allOverlays().filter(o => !before.includes(o.id)).map(o => o.id)

async function scenario () {
  await H.ready(chartPro)
  const c = chart()
  check('chart ready', !!c && c.getDataList().length > 50, c && c.getDataList().length)

  // Host overlays, as the wallet's agent layers make them: names shared with drawing tools, no group.
  const dl = c.getDataList()
  const last = dl[dl.length - 1]
  const hostRect = c.createOverlay({ name: 'rect', points: [{ timestamp: dl[dl.length - 60].timestamp, value: last.close + 12 }, { timestamp: dl[dl.length - 40].timestamp, value: last.close + 6 }] })
  const hostLine = c.createOverlay({ name: 'horizontalStraightLine', points: [{ timestamp: dl[dl.length - 30].timestamp, value: last.close - 15 }] })
  // SC-091: chartPro.addHostOverlay, the public API for the above (not just
  // raw createOverlay — this is what a host is actually meant to call).
  // FakeChart-level behaviour (locked default, draggable+onChange, onRemove,
  // survives right-click) is covered in controller.test.ts; this is the live
  // check that the public method reaches it at all. Included in hostIds below,
  // so every "hosts kept untouched" check for the rest of the suite covers it too.
  const apiHostId = chartPro.addHostOverlay({ name: 'horizontalStraightLine', points: [{ timestamp: dl[dl.length - 20].timestamp, value: last.close - 25 }] })
  check('addHostOverlay creates a real overlay, locked by default', !!apiHostId && c.getOverlayById(apiHostId)?.lock === true)
  await sleep(300)
  const hostIds = [hostRect, hostLine, apiHostId]
  const hostBefore = hostSnapshot(hostIds)
  const hostLineY = c.convertToPixel({ timestamp: dl[dl.length - 30].timestamp, value: last.close - 15 }, { paneId: 'candle_pane' }).y
  const hostRectPx = c.convertToPixel([{ timestamp: dl[dl.length - 60].timestamp, value: last.close + 12 }, { timestamp: dl[dl.length - 40].timestamp, value: last.close + 6 }], { paneId: 'candle_pane' })
  const apiHostY = c.convertToPixel({ timestamp: dl[dl.length - 20].timestamp, value: last.close - 25 }, { paneId: 'candle_pane' }).y
  await clickAt({ x: box().left + 500, y: box().top + apiHostY }, 2) // right-click
  await sleep(50)
  check('addHostOverlay: survives right-click, no toolbar (not a drawing-bar overlay)', !!c.getOverlayById(apiHostId) && !toolbar())

  // 1. Draw a line from the drawing bar (first rail item's main icon). SC-118:
  // the default is now 'segment' (TradingView's Trend Line, two points), not
  // the old one-click 'horizontalStraightLine' — both endpoints are placed at
  // y=150 so the segment behaves like a horizontal line across every x this
  // suite later clicks at (300-650), without changing the rest of the checks.
  let before = allOverlays().map(o => o.id)
  railItems()[0].querySelector('.icon-overlay-btn').click()
  await sleep(100)
  await clickAt(P(300, 150))
  await clickAt(P(650, 150))
  let userLine = newUserIds(before)[0]
  check('draw: line created in drawing group', !!userLine && c.getOverlayById(userLine).groupId === 'drawing_tools', userLine)
  check('draw end: toolbar shown', toolbarVisible())
  check('toolbar: role/aria', toolbar()?.getAttribute('role') === 'toolbar' && !!toolbar()?.getAttribute('aria-label'))
  const unlabeled = [...(toolbar()?.querySelectorAll('button') ?? [])].filter(b => !(b.getAttribute('aria-label') || '').trim())
  check('toolbar: every button has an accessible name', unlabeled.length === 0, unlabeled.length)
  check('toolbar: line has no text colour control', !btn(LOCALE === 'en-US' ? 'Text color' : '文字颜色'))
  const tb = toolbar().getBoundingClientRect(), wr = kc().getBoundingClientRect()
  check('toolbar: inside chart area', tb.left >= wr.left - 1 && tb.right <= wr.right + 1 && tb.top >= wr.top - 1 && tb.bottom <= wr.bottom + 1, JSON.stringify({ tb: [tb.left, tb.top, tb.right, tb.bottom], wr: [wr.left, wr.top, wr.right, wr.bottom] }))
  check('toolbar: does not cover the line (y=150)', tb.bottom - wr.top < 150 - 3 || tb.top - wr.top > 150 + 3, [tb.top - wr.top, tb.bottom - wr.top])

  // 2. Empty click deselects; clicking the line selects again.
  await clickAt(P(420, 300))
  check('empty click hides toolbar', !toolbar())
  const linePx = c.convertToPixel(c.getOverlayById(userLine).points, { paneId: 'candle_pane' })
  await clickAt(P(500, 150))
  const ci = store().getClickInstanceInfo()
  check('click on drawing shows toolbar', toolbarVisible(), JSON.stringify({ linePx, points: c.getOverlayById(userLine).points, click: { paneId: ci.paneId, id: ci.instance && ci.instance.id, ft: ci.figureType }, hover: store().getHoverInstanceInfo().instance?.id, tb: !!toolbar(), vis: toolbar() && getComputedStyle(toolbar()).visibility, key: 0 }))

  // 3. Line colour via palette.
  btn('Line color').click()
  await sleep(50)
  const swatch = toolbar().querySelector('.tb-swatch[title="#F23645"]')
  // The theme's drawing default is the accent (#2962FF), the first preset too:
  // one blue in the palette, not two near-identical ones (SC-051).
  const blues = [...toolbar().querySelectorAll('.tb-swatch')].map(e => e.getAttribute('title')).filter(t => /^#[0-9A-F]{6}$/i.test(t) && Math.max(...[1, 3, 5].map(i => Math.abs(parseInt(t.slice(i, i + 2), 16) - parseInt('#2962FF'.slice(i, i + 2), 16)))) < 48)
  check('colour popover: palette shown, theme default first', !!swatch && toolbar().querySelector('.tb-swatch').getAttribute('title') === '#2962FF' && blues.length === 1, JSON.stringify(blues))
  swatch.click()
  await sleep(50)
  check('line colour applied', c.getOverlayById(userLine).styles?.line?.color === '#F23645', JSON.stringify(c.getOverlayById(userLine).styles))
  // opacity
  const range = toolbar().querySelector('input[type="range"]')
  range.value = '50'; range.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(50)
  check('opacity applied', c.getOverlayById(userLine).styles?.line?.color === 'rgba(242, 54, 69, 0.5)', c.getOverlayById(userLine).styles?.line?.color)
  // hex input
  const hex = toolbar().querySelector('.tb-hex')
  hex.value = '#00ff00'; hex.dispatchEvent(new Event('input', { bubbles: true }))
  hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(50)
  check('hex applied, opacity kept', c.getOverlayById(userLine).styles?.line?.color === 'rgba(0, 255, 0, 0.5)', c.getOverlayById(userLine).styles?.line?.color)
  // Backspace inside the hex field must not delete the drawing
  hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
  await sleep(50)
  check('Backspace in hex input does not delete', !!c.getOverlayById(userLine))
  // Escape closes the popover first
  key('Escape')
  await sleep(50)
  check('Escape closes popover, keeps toolbar', toolbarVisible() && !toolbar().querySelector('.tb-popover'))

  // 4. Width and style.
  btnStart('Line width').click(); await sleep(50)
  toolbar().querySelector('.tb-menu-item[aria-label="Line width 3px"]').click(); await sleep(50)
  check('width 3 applied', c.getOverlayById(userLine).styles?.line?.size === 3 && btnStart('Line width').textContent.includes('3px'))
  btnStart('Line style').click(); await sleep(50)
  ;[...toolbar().querySelectorAll('.tb-menu-item')].find(b => b.textContent.includes('Dotted')).click(); await sleep(50)
  const ls = c.getOverlayById(userLine).styles?.line
  check('dotted applied', ls?.style === 'dashed' && JSON.stringify(ls?.dashedValue) === '[2,2]', JSON.stringify(ls))

  // 5. Lock: cannot be dragged, survives right-click.
  btn('Lock').click(); await sleep(50)
  check('lock applied + icon state', c.getOverlayById(userLine).lock === true && btn('Lock')?.getAttribute('aria-pressed') === 'true' && !btn('Unlock'))
  const pts0 = JSON.stringify(c.getOverlayById(userLine).points)
  await dragFrom(P(500, 150), P(500, 250))
  check('locked drawing does not move', JSON.stringify(c.getOverlayById(userLine).points) === pts0)
  await clickAt(P(520, 150), 2)
  check('locked drawing survives right-click', !!c.getOverlayById(userLine))
  await clickAt(P(500, 150))
  btn('Lock').click(); await sleep(50)
  check('unlock', c.getOverlayById(userLine).lock === false && btn('Lock')?.getAttribute('aria-pressed') === 'false')

  // 6. Escape deselects; host overlays never get the toolbar.
  key('Escape'); await sleep(50)
  check('Escape hides toolbar', !toolbar())
  await clickAt({ x: box().left + 500, y: box().top + hostLineY })
  check('host line click: no toolbar', !toolbar())
  await clickAt({ x: box().left + (hostRectPx[0].x + hostRectPx[1].x) / 2, y: box().top + (hostRectPx[0].y + hostRectPx[1].y) / 2 })
  check('host rect click: no toolbar', !toolbar())
  key('Delete'); await sleep(50)
  check('Delete with a host overlay selected removes nothing', hostIds.every(id => !!c.getOverlayById(id)) && !!c.getOverlayById(userLine))

  // 7. Keys in host UI outside the chart are ignored.
  await clickAt(P(500, 150))
  check('reselect line', toolbarVisible())
  const hostInput = document.getElementById('hostinput')
  hostInput.focus()
  key('Delete', hostInput); key('Escape', hostInput)
  const hostButton = document.createElement('button'); document.getElementById('hostui').appendChild(hostButton); hostButton.focus()
  key('Backspace', hostButton)
  await sleep(50)
  check('keys from host UI ignored', !!c.getOverlayById(userLine) && toolbarVisible())
  hostButton.blur()
  // a press on (non-focusable) host UI, then Delete with nothing focused: not for the chart
  document.getElementById('hostui').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
  key('Delete')
  await sleep(50)
  check('unfocused Delete after a press on host UI is ignored', !!c.getOverlayById(userLine) && toolbarVisible())
  kc().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))

  // 8. Drag the toolbar: clamped and remembered.
  const grip = btn('Drag to move')
  const g = grip.getBoundingClientRect()
  grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, button: 0, clientX: g.left + 4, clientY: g.top + 4 }))
  grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: g.left + 4 + 5000, clientY: g.top + 4 + 5000 }))
  grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: g.left + 4 + 5000, clientY: g.top + 4 + 5000 }))
  await sleep(50)
  let t2 = toolbar().getBoundingClientRect()
  check('drag clamps to the chart (bottom-right)', Math.abs(t2.right - box().right) <= 1 && Math.abs(t2.bottom - box().bottom) <= 1, JSON.stringify([t2.right, box().right, t2.bottom, box().bottom]))
  await clickAt(P(420, 300)); await clickAt(P(500, 150))
  const t3 = toolbar().getBoundingClientRect()
  check('dragged position persists across selections', Math.abs(t3.left - t2.left) <= 1 && Math.abs(t3.top - t2.top) <= 1)

  // 9. Rail lock / hide-all / magnet leave host overlays alone.
  check('host overlays untouched so far', hostSnapshot(hostIds) === hostBefore)
  // lock-all / eye / trash are the rail items without a popover arrow
  const plainItems = railItems().filter(i => !i.querySelector('.icon-arrow'))
  plainItems[0].querySelector('.icon-overlay-btn').click(); await sleep(50) // lock all
  plainItems[1].querySelector('.icon-overlay-btn').click(); await sleep(50) // hide all
  check('rail lock+hide: user drawing locked+hidden', c.getOverlayById(userLine).lock === true && c.getOverlayById(userLine).visible === false)
  check('rail lock+hide: host overlays untouched', hostSnapshot(hostIds) === hostBefore)
  plainItems[1].querySelector('.icon-overlay-btn').click(); await sleep(50) // show all
  plainItems[0].querySelector('.icon-overlay-btn').click(); await sleep(50) // unlock all
  check('rail show+unlock restores user drawing', c.getOverlayById(userLine).lock === false && c.getOverlayById(userLine).visible === true)

  // 10. More menu: hide, then eye restores.
  await clickAt(P(500, 150))
  btn('More').click(); await sleep(50)
  ;[...toolbar().querySelectorAll('.tb-menu-item')].find(b => b.textContent.includes('Hide')).click(); await sleep(50)
  check('hide: invisible + toolbar closed', c.getOverlayById(userLine).visible === false && !toolbar())
  plainItems[1].querySelector('.icon-overlay-btn').click(); await sleep(50) // eye: show all (one click)
  check('eye restores hidden drawing in one click', c.getOverlayById(userLine).visible === true)

  // 10b. A full press on a toolbar button does not reach the chart; grip arrow keys move the toolbar.
  await clickAt(P(500, 150))
  const moreBtn = btn('More'); const mb = moreBtn.getBoundingClientRect()
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent
    moreBtn.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: mb.left + 5, clientY: mb.top + 5, button: 0, buttons: 1 }))
  }
  await sleep(650)
  check('pressing a toolbar button keeps the drawing selected (no fall-through)', toolbarVisible() && store().getClickInstanceInfo().instance?.id === userLine && !!toolbar().querySelector('.tb-menu'))
  key('Escape'); await sleep(20)
  const gripBtn = btn('Drag to move'); const g0 = toolbar().getBoundingClientRect()
  gripBtn.focus()
  gripBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
  gripBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  await sleep(50)
  const g1 = toolbar().getBoundingClientRect()
  check('grip arrow keys move the toolbar', Math.round(g0.left - g1.left) === 10 && Math.round(g0.top - g1.top) === 10, [g0.left - g1.left, g0.top - g1.top])
  key('Escape'); await sleep(20)
  // eye off -> a new drawing is still created visible
  plainItems[1].querySelector('.icon-overlay-btn').click(); await sleep(50) // hide all
  before = allOverlays().map(o => o.id)
  railItems()[0].querySelector('.icon-overlay-btn').click(); await sleep(50)
  await clickAt(P(300, 330))
  await clickAt(P(650, 330))
  const hiddenModeLine = newUserIds(before)[0]
  check('new drawing is visible while the eye hides all', !!hiddenModeLine && c.getOverlayById(hiddenModeLine).visible === true && c.getOverlayById(userLine).visible === false)
  key('Delete'); await sleep(50)
  plainItems[1].querySelector('.icon-overlay-btn').click(); await sleep(50) // show all
  check('eye shows all again', c.getOverlayById(userLine).visible === true && !c.getOverlayById(hiddenModeLine))

  // 11. Rect from the polygon popover: selectable, clone, order.
  before = allOverlays().map(o => o.id)
  const polygonItem = railItems()[2]
  polygonItem.querySelector('.icon-arrow').click(); await sleep(50)
  ;[...document.querySelectorAll('.klinecharts-pro-drawing-bar-flyout li')].find(li => li.textContent.trim() === 'Rect').click(); await sleep(50)
  await clickAt(P(150, 60)); await clickAt(P(260, 120))
  const userRect = newUserIds(before)[0]
  check('popover tool gets drawing group (remove-all fix)', !!userRect && c.getOverlayById(userRect).groupId === 'drawing_tools')
  check('rect: toolbar with line colour, no text colour', toolbarVisible() && !!btn('Line color') && !btn('Text color'))
  btn('Line color').click(); await sleep(50)
  toolbar().querySelector('.tb-swatch[title="#089981"]').click(); await sleep(50)
  const rs = c.getOverlayById(userRect).styles
  check('rect colour: border + fill keeps its opacity', rs?.polygon?.borderColor === '#089981' && rs?.polygon?.color === 'rgba(8, 153, 129, 0.15)', JSON.stringify(rs))
  key('Escape'); await sleep(20)
  before = allOverlays().map(o => o.id)
  btn('More').click(); await sleep(50)
  ;[...toolbar().querySelectorAll('.tb-menu-item')].find(b => b.textContent.includes('Clone')).click(); await sleep(50)
  const cloneId = newUserIds(before)[0]
  const orig = c.getOverlayById(userRect), copy = cloneId && c.getOverlayById(cloneId)
  check('clone: copy created, offset, same style, selected', !!copy && JSON.stringify(copy.points) !== JSON.stringify(orig.points) && copy.styles?.polygon?.borderColor === '#089981' && store().getClickInstanceInfo().instance?.id === cloneId, cloneId)
  const order = () => store().getInstances('candle_pane').map(o => o.id)
  btn('More').click(); await sleep(50)
  ;[...toolbar().querySelectorAll('.tb-menu-item')].find(b => b.textContent.includes('Send to back')).click(); await sleep(50)
  check('send to back', order()[0] === cloneId, JSON.stringify(order()))
  btn('More').click(); await sleep(50)
  ;[...toolbar().querySelectorAll('.tb-menu-item')].find(b => b.textContent.includes('Bring to front')).click(); await sleep(50)
  check('bring to front', order()[order().length - 1] === cloneId, JSON.stringify(order()))

  // 12. Previously unselectable tool: Long Position is now clickable.
  before = allOverlays().map(o => o.id)
  const posItem = railItems()[5]
  posItem.querySelector('.icon-overlay-btn').click(); await sleep(50)
  await clickAt(P(600, 250)); await clickAt(P(700, 200)); await clickAt(P(700, 300))
  const userPos = newUserIds(before)[0]
  await clickAt(P(420, 420))
  check('position drawn and deselected', !!userPos && !toolbar())
  await clickAt(P(650, 225))
  check('position: selectable by its zone, only lock/delete/more', toolbarVisible() && !btn('Line color') && !!btn('Lock') && !!btn('Delete'))
  key('Escape'); await sleep(20)

  // 13. Text tool: text colour control.
  before = allOverlays().map(o => o.id)
  const textItem = railItems()[7]
  textItem.querySelector('.icon-arrow').click(); await sleep(50)
  ;[...document.querySelectorAll('.klinecharts-pro-drawing-bar-flyout li')].find(li => li.textContent.trim() === 'Note').click(); await sleep(50)
  await clickAt(P(200, 400))
  const userNote = newUserIds(before)[0]
  check('note: text colour only', toolbarVisible() && !!btn('Text color') && !btn('Line color'))
  btn('Text color').click(); await sleep(50)
  toolbar().querySelector('.tb-swatch[title="#131722"]').click(); await sleep(50)
  // The box's colour is the chart's accent, resolved when the note draws
  // (src/extension/accent.ts); its shape lives on the overlay's styles.
  const noteText = c.getOverlayById(userNote).styles?.text
  check('note: text colour applied, box styles kept', noteText?.color === '#131722' && noteText?.paddingLeft === 8 && noteText?.borderRadius === 4, JSON.stringify(c.getOverlayById(userNote).styles))

  // 14. Delete key and toolbar trash.
  key('Escape'); await sleep(20)
  await clickAt(P(500, 150))
  key('Delete'); await sleep(50)
  check('Delete key removes selected line, toolbar closes', !c.getOverlayById(userLine) && !toolbar())
  await clickAt(P(650, 225))
  btn('Delete').click(); await sleep(50)
  check('trash removes selected position', !c.getOverlayById(userPos) && !toolbar())
  check('host overlays untouched at the end', hostSnapshot(hostIds) === hostBefore)

  // 15. Remove-all removes only user drawings.
  const removeItem = railItems()[railItems().length - 1]
  removeItem.querySelector('.icon-overlay-btn').click(); await sleep(50)
  // Engine-owned chrome overlays (SC-052's bar countdown, SC-NEXT's High/Low
  // axis tags and custom-series renderer) are neither a user drawing nor one
  // of this suite's own host overlays — they are never editor-tracked
  // (drawing-editor/controller.ts never sees their ids), so "remove-all"
  // correctly leaves them alone. The countdown never actually appears here
  // (this fixture's bars are timestamped in the past, so its bar-close
  // countdown is always null), but High/Low tags show for any visible data.
  const ENGINE_OVERLAY_NAMES = ['scBarCountdown', 'scHighLowTags', 'scCustomSeries']
  const isEngineOwned = o => ENGINE_OVERLAY_NAMES.includes(o.name)
  check('remove-all: user drawings gone, hosts kept', allOverlays().every(o => hostIds.includes(o.id) || isEngineOwned(o)) && hostIds.every(id => !!c.getOverlayById(id)), JSON.stringify(allOverlays().map(o => o.name)))

  // 16. Zoom / scroll still work (wheel + drag on empty space).
  const range0 = JSON.stringify(c.getVisibleRange())
  const dragY = Math.abs(hostLineY - 350) < 30 ? 250 : 350
  await dragFrom(P(200, dragY), P(450, dragY)) // towards older bars (the view starts at the right edge)
  check('drag on empty chart still scrolls', JSON.stringify(c.getVisibleRange()) !== range0, [range0, JSON.stringify(c.getVisibleRange())])
  const space0 = c.getBarSpace()
  const wt = kc(); const wp = P(400, dragY)
  fire(wt, 'mouseenter', wp.x, wp.y)
  wt.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: wp.x, clientY: wp.y, deltaY: -120, deltaMode: 0 }))
  await sleep(300)
  check('wheel still zooms', c.getBarSpace() !== space0, [space0, c.getBarSpace()])

  // 17. A different symbol closes the toolbar: the drawing keeps the old prices.
  before = allOverlays().map(o => o.id)
  railItems()[0].querySelector('.icon-overlay-btn').click(); await sleep(50)
  await clickAt(P(300, 200))
  await clickAt(P(650, 200))
  check('draw again before a symbol switch', toolbarVisible() && newUserIds(before).length === 1)
  chartPro.setSymbol({ ticker: 'OTHER-USDT', pricePrecision: 2, volumePrecision: 0 })
  await sleep(300)
  check('switching symbol closes the drawing toolbar', !toolbar())

  // From here on the chart is on OTHER-USDT: a blank editor slate (its own
  // per-symbol drawings, per SC-120, are empty) but the same host overlays
  // (klinecharts overlays are chart-level, not tied to the datafeed).
  const dl2 = c.getDataList()
  const barMs = dl2[1].timestamp - dl2[0].timestamp

  // 18. Style memory (SC-119): a fresh drawing of the same tool inherits the
  // last-used style, even though the drawing that set it (userLine, step 1-4:
  // green rgba(0,255,0,0.5), width 3, dashed) was deleted long ago in step 14.
  // FakeChart-level logic is covered in controller.test.ts; this is the live
  // wiring check — prepareNew() actually reaches a freshly placed overlay.
  before = allOverlays().map(o => o.id)
  railItems()[0].querySelector('.icon-overlay-btn').click(); await sleep(50)
  // SC-118: item[0]'s default is 'segment' (two points), not the old
  // one-click 'horizontalStraightLine'; both endpoints at y=380 so every
  // reselection click below (always at (250, 380)) lands on the line.
  await clickAt(P(250, 380))
  await clickAt(P(400, 380))
  const undoLine = newUserIds(before)[0]
  check('draw for the SC-119/SC-092/SC-109 checks below', !!undoLine)
  const rememberedLine = c.getOverlayById(undoLine).styles?.line
  check('SC-119: it inherits the last line colour, width and dash, not the tool default',
    rememberedLine?.color === 'rgba(0, 255, 0, 0.5)' && rememberedLine?.size === 3 && rememberedLine?.style === 'dashed',
    JSON.stringify(rememberedLine))

  // 19. Undo/redo (SC-092) via real Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y keydown
  // events, reaching editor.undo()/redo() through ChartProComponent's own
  // shortcut handler (FakeChart-level history logic: controller.test.ts).
  // Undoing a delete restores the drawing but (unlike redoing a fresh
  // creation) does not reselect it, so a Delete right after an undo needs an
  // explicit reselect first, the same way a real user would click it again.
  key('Delete'); await sleep(50)
  check('Delete removes it', !c.getOverlayById(undoLine))
  keyMod('z', { ctrlKey: true }); await sleep(50)
  check('Ctrl+Z undoes the delete', !!c.getOverlayById(undoLine))
  keyMod('z', { ctrlKey: true, shiftKey: true }); await sleep(50)
  check('Ctrl+Shift+Z redoes it (deleted again)', !c.getOverlayById(undoLine))
  keyMod('z', { ctrlKey: true }); await sleep(50)
  check('Ctrl+Z undoes once more, restoring it', !!c.getOverlayById(undoLine))
  await clickAt(P(250, 380)) // reselect before deleting it again
  key('Delete'); await sleep(50)
  keyMod('z', { ctrlKey: true }); await sleep(50) // undo this second delete
  keyMod('y', { ctrlKey: true }); await sleep(50) // Ctrl+Y: redo (delete again)
  check('Ctrl+Y also redoes (deleted again)', !c.getOverlayById(undoLine))
  keyMod('z', { ctrlKey: true }); await sleep(50)
  check('final Ctrl+Z restores it, leaving it in place for the checks below', !!c.getOverlayById(undoLine))

  // 20. Duplicate (Ctrl+D), copy/paste (Ctrl+C/Ctrl+V) and nudge (arrow keys) — SC-109.
  await clickAt(P(250, 380))
  check('reselected for duplicate check', toolbarVisible())
  before = allOverlays().map(o => o.id)
  keyMod('d', { ctrlKey: true }); await sleep(50)
  const dupId = newUserIds(before)[0]
  check('Ctrl+D duplicates the selected drawing, selects the copy', !!dupId && store().getClickInstanceInfo().instance?.id === dupId)
  key('Delete'); await sleep(50) // tidy up the duplicate

  await clickAt(P(250, 380))
  const selBeforePaste = store().getClickInstanceInfo().instance?.id
  // A stray real text selection (e.g. from an earlier synthetic click that a
  // real user's next mousedown would have collapsed, but a synthetic
  // dispatchEvent does not) would make editorShortcut's Ctrl+C defer to the
  // browser's own copy instead of editor.copy() (by design — see
  // ChartProComponent's editorShortcut). Clear it so this check exercises
  // the drawing-copy path, the same as a real user with nothing text-selected.
  window.getSelection()?.removeAllRanges()
  const textSel = window.getSelection()?.toString() ?? ''
  const progressBefore = JSON.stringify(store().getProgressInstanceInfo())
  before = allOverlays().map(o => o.id)
  keyMod('c', { ctrlKey: true }); await sleep(20)
  keyMod('v', { ctrlKey: true }); await sleep(50)
  const pasteId = newUserIds(before)[0]
  check('Ctrl+C then Ctrl+V pastes an offset copy', !!pasteId && pasteId !== undoLine,
    JSON.stringify({ selBeforePaste, undoLine, pasteId, textSel, progressBefore, newIds: newUserIds(before), allNow: allOverlays().map(o => o.id) }))
  if (pasteId !== undefined) { key('Delete'); await sleep(50) } // tidy up the pasted copy, if one exists

  await clickAt(P(250, 380))
  const nudgeSrc = c.getOverlayById(undoLine)
  if (nudgeSrc !== null) {
    const beforeTs = nudgeSrc.points.map(p => p.timestamp)
    key('ArrowRight'); await sleep(50)
    const afterTs = c.getOverlayById(undoLine).points.map(p => p.timestamp)
    check('ArrowRight nudges the selected drawing by exactly one bar', afterTs.every((t, i) => t - beforeTs[i] === barMs), JSON.stringify({ beforeTs, afterTs, barMs }))
    key('ArrowLeft'); await sleep(50) // put it back for the checks below
  } else {
    check('ArrowRight nudges the selected drawing by exactly one bar', false, 'undoLine missing before the nudge check')
  }

  // 21. Right-click context menu (SC-090): open/close/target logic is
  // covered at the FakeChart level in controller.test.ts; this is the live
  // DOM check — a real role="menu" appears at the press point.
  await clickAt(P(250, 380))
  await clickAt(P(250, 380), 2) // right-click
  await sleep(50)
  let ctxMenu = document.querySelector('.klinecharts-pro-drawing-context-menu')
  check('right-click opens a role=menu context menu, focused', !!ctxMenu && ctxMenu.getAttribute('role') === 'menu' && document.activeElement === ctxMenu)
  const ctxDelete = ctxMenu ? [...ctxMenu.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('Delete')) : null
  check('context menu has a Delete item', !!ctxDelete)
  key('Escape', ctxMenu); await sleep(50)
  check('Escape closes the context menu without deleting', !document.querySelector('.klinecharts-pro-drawing-context-menu') && !!c.getOverlayById(undoLine))
  await clickAt(P(250, 380), 2); await sleep(50)
  ctxMenu = document.querySelector('.klinecharts-pro-drawing-context-menu')
  const ctxDelete2 = ctxMenu ? [...ctxMenu.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('Delete')) : null
  ctxDelete2?.click()
  await sleep(50)
  check('clicking Delete in the context menu removes the drawing and closes the menu', !c.getOverlayById(undoLine) && !document.querySelector('.klinecharts-pro-drawing-context-menu'))

  // 22. Inline text/image editor (SC-093): no window.prompt, typing + Enter
  // commits to extendData, double-click reopens it with the current text,
  // Escape cancels and keeps the original.
  let promptCalled = false
  window.prompt = () => { promptCalled = true; return 'SHOULD NOT BE USED' }
  before = allOverlays().map(o => o.id)
  const textItem2 = railItems()[7]
  textItem2.querySelector('.icon-arrow').click(); await sleep(50)
  ;[...document.querySelectorAll('.klinecharts-pro-drawing-bar-flyout li')].find(li => li.textContent.trim() === 'Note').click(); await sleep(50)
  await clickAt(P(350, 420))
  const noteId2 = newUserIds(before)[0]
  check('placing a text-typed drawing never calls window.prompt', !promptCalled && !!noteId2)
  let dte = document.querySelector('.klinecharts-pro-drawing-text-editor input')
  check('the inline editor opens on placement, focused and selected', !!dte && document.activeElement === dte)
  dte.value = 'Hi there'
  dte.dispatchEvent(new Event('input', { bubbles: true }))
  dte.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await sleep(50)
  check('Enter commits the typed text to extendData and closes the editor',
    c.getOverlayById(noteId2).extendData === 'Hi there' && !document.querySelector('.klinecharts-pro-drawing-text-editor'))
  await clickAt(P(350, 420))
  const notePt = c.getOverlayById(noteId2).points[0]
  const notePx = c.convertToPixel(notePt, { paneId: 'candle_pane' })
  kc().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: box().left + notePx.x, clientY: box().top + notePx.y }))
  await sleep(50)
  dte = document.querySelector('.klinecharts-pro-drawing-text-editor input')
  check('double-click on a finished text drawing reopens the inline editor with its current text', !!dte && dte.value === 'Hi there')
  key('Escape', dte); await sleep(50)
  check('Escape cancels the edit: keeps the original text, closes the editor',
    !document.querySelector('.klinecharts-pro-drawing-text-editor') && c.getOverlayById(noteId2).extendData === 'Hi there')
  key('Delete'); await sleep(50) // tidy up the note

  // 23. Objects panel (SC-151): lists only tracked user drawings (never a
  // host overlay); a row's own eye/select/delete act on exactly that row.
  before = allOverlays().map(o => o.id)
  // item[0]'s remembered default is now 'segment' (SC-118); pick
  // 'horizontalStraightLine' explicitly from its flyout so the rest of this
  // step's name-based checks (and step 24's single click) still apply.
  railItems()[0].querySelector('.icon-arrow').click(); await sleep(50)
  ;[...document.querySelectorAll('.klinecharts-pro-drawing-bar-flyout li')].find(li => li.textContent.trim() === 'Horizontal Line').click(); await sleep(50)
  await clickAt(P(220, 200))
  const opLine = newUserIds(before)[0]
  before = allOverlays().map(o => o.id)
  const polyItem2 = railItems()[2]
  polyItem2.querySelector('.icon-arrow').click(); await sleep(50)
  ;[...document.querySelectorAll('.klinecharts-pro-drawing-bar-flyout li')].find(li => li.textContent.trim() === 'Rect').click(); await sleep(50)
  await clickAt(P(150, 60)); await clickAt(P(260, 120))
  const opRect = newUserIds(before)[0]
  key('Escape'); await sleep(20)

  const opTrigger = document.querySelector('.klinecharts-pro-objects-trigger')
  check('objects panel trigger exists', !!opTrigger)
  opTrigger.click(); await sleep(50)
  let panel = document.querySelector('.klinecharts-pro-objects-panel')
  const rowNames = panel ? [...panel.querySelectorAll('.op-name')].map(b => b.textContent.trim()) : []
  check('objects panel opens as a dialog listing exactly the tracked drawings',
    panel?.getAttribute('role') === 'dialog' && rowNames.filter(n => n === 'horizontalStraightLine').length === 1 && rowNames.filter(n => n === 'rect').length === 1 && rowNames.length === 2,
    JSON.stringify(rowNames))

  // Each row is rebuilt (not patched) whenever the panel refreshes — listDrawings()
  // returns fresh row objects every call, and Solid's <For> keys by reference — so
  // a cached button reference goes stale after any action that calls
  // refreshObjectsRows(). Re-query rowFor(...) fresh before every click below.
  const rowFor = name => [...panel.querySelectorAll('.op-row')].find(li => li.querySelector('.op-name').textContent.trim() === name)
  if (panel !== null && rowFor('horizontalStraightLine') !== undefined && rowFor('rect') !== undefined) {
    rowFor('horizontalStraightLine').querySelectorAll('.op-icon')[0].click(); await sleep(50)
    check('the eye on one row hides only that drawing', c.getOverlayById(opLine).visible === false && c.getOverlayById(opRect).visible === true)
    rowFor('horizontalStraightLine').querySelectorAll('.op-icon')[0].click(); await sleep(50)
    check('clicking it again restores visibility', c.getOverlayById(opLine).visible === true)

    // editor.select(id) is the editor's own notion of "selected" (what drives
    // the floating toolbar) — it does not itself update klinecharts' separate
    // click-instance store, which only follows real pointer events on the
    // canvas, so the toolbar showing is the right signal here, not that store.
    rowFor('rect').querySelector('.op-name').click(); await sleep(50)
    check('selecting a row selects that drawing on the chart', toolbarVisible())

    rowFor('rect').querySelectorAll('.op-icon')[2].click(); await sleep(50)
    check('the row\'s delete icon removes exactly that drawing, keeps the other', !c.getOverlayById(opRect) && !!c.getOverlayById(opLine))

    key('Escape', document.querySelector('.klinecharts-pro-objects-panel') ?? document.body); await sleep(50)
    check('Escape closes the objects panel and returns focus to its trigger', !document.querySelector('.klinecharts-pro-objects-panel') && document.activeElement === opTrigger)
  } else {
    check('the eye on one row hides only that drawing', false, 'panel/rows missing, skipped')
    check('clicking it again restores visibility', false, 'panel/rows missing, skipped')
    check('selecting a row selects that drawing on the chart', false, 'panel/rows missing, skipped')
    check('the row\'s delete icon removes exactly that drawing, keeps the other', false, 'panel/rows missing, skipped')
    check('Escape closes the objects panel and returns focus to its trigger', false, 'panel/rows missing, skipped')
  }
  if (c.getOverlayById(opLine)) { await clickAt(P(220, 200)); await sleep(50); key('Delete'); await sleep(50) } // tidy up opLine, if it's still there
  if (c.getOverlayById(opRect)) { await clickAt(P(205, 90)); await sleep(50); key('Delete'); await sleep(50) } // tidy up opRect, if it's still there

  // 24. Toolbar keyboard a11y (SC-150): Escape returns focus to the trigger
  // (both a menu-role popover and a dialog-role one); ArrowDown on a trigger
  // opens its popover with focus already inside it; Up/Down/Home/End
  // navigate an open menu; the hex field shows visible error text, not colour alone.
  before = allOverlays().map(o => o.id)
  railItems()[0].querySelector('.icon-overlay-btn').click(); await sleep(50)
  await clickAt(P(300, 480))
  const kbdLine = newUserIds(before)[0]
  check('draw for the SC-150 checks', !!kbdLine)

  const widthTrigger = btnStart('Line width')
  widthTrigger.focus()
  widthTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  await sleep(50)
  let widthMenu = toolbar().querySelector('.tb-menu')
  let checkedItem = widthMenu?.querySelector('.tb-menu-item[aria-checked="true"]')
  check('ArrowDown on a trigger opens its menu, focus on the checked item', !!widthMenu && document.activeElement === checkedItem)

  const widthItems = [...widthMenu.querySelectorAll('.tb-menu-item')]
  widthMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
  check('End moves focus to the last menu item', document.activeElement === widthItems[widthItems.length - 1])
  widthMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
  check('Home moves focus to the first menu item', document.activeElement === widthItems[0])
  widthMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  check('ArrowUp wraps from the first to the last item', document.activeElement === widthItems[widthItems.length - 1])

  key('Escape', document.activeElement); await sleep(50)
  check('Escape on a menu item closes the popover and returns focus to its trigger', !toolbar().querySelector('.tb-popover') && document.activeElement === widthTrigger)

  btn('Line color').click(); await sleep(50)
  const opacityRange = toolbar().querySelector('input[type="range"]')
  opacityRange.focus()
  key('Escape', opacityRange); await sleep(50)
  check('Escape on the opacity slider closes the popover and returns focus to its trigger', !toolbar().querySelector('.tb-popover') && document.activeElement === btn('Line color'))

  btn('Line color').click(); await sleep(50)
  const hex2 = toolbar().querySelector('.tb-hex')
  hex2.value = 'not-a-color'; hex2.dispatchEvent(new Event('input', { bubbles: true }))
  hex2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await sleep(50)
  let errorEl = document.getElementById(hex2.getAttribute('aria-describedby') || '')
  check('an invalid hex value shows visible error text tied to the field by aria-describedby',
    hex2.getAttribute('aria-invalid') === 'true' && !!errorEl && errorEl.textContent.length > 0)
  hex2.value = '#123456'; hex2.dispatchEvent(new Event('input', { bubbles: true }))
  hex2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await sleep(50)
  check('a valid value clears the error and aria-describedby', hex2.getAttribute('aria-invalid') === 'false' && !hex2.hasAttribute('aria-describedby'))
  key('Escape', hex2); await sleep(50)
  check('that Escape also returns focus to the Line color trigger', document.activeElement === btn('Line color'))
  key('Delete'); await sleep(50)
  check('cleanup: kbdLine removed', !c.getOverlayById(kbdLine))

  check('klinecharts version', true, H.kcVersion)
}


  try {
    await scenario()
  } catch (e) {
    check('driver exception', false, String(e && e.stack || e))
  }
  return results
}
