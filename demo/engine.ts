import type { EngineRenderOptions } from '@supersolutions/super-chart-core'
import type { DrawingType, PriceScaleMode } from '@supersolutions/super-chart-core'

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const start = performance.now()
// Load the renderer only when its host is mounted. The engine entry has no UI framework.
const { EngineChart } = await import('@supersolutions/super-chart-web')
const { ENGINE_CHART_TYPES, DRAWING_TYPES } = await import('@supersolutions/super-chart-core')
byId<HTMLSelectElement>('style').replaceChildren(...ENGINE_CHART_TYPES.filter(type => type !== 'point-figure').map(type => new Option(type, type)))
byId<HTMLSelectElement>('drawing').replaceChildren(new Option('Select / pan', ''), ...DRAWING_TYPES.map(type => new Option(type, type)))
const chart = new EngineChart(byId('chart'), { onToolComplete: () => { byId<HTMLSelectElement>('drawing').value = '' }, onInspect: hit => {
  byId('readout').textContent = hit === null ? '' : `${new Date(hit.timestamp).toISOString()} · ${hit.mode} · O ${hit.displayBar.open.toFixed(4)} H ${hit.displayBar.high.toFixed(4)} L ${hit.displayBar.low.toFixed(4)} C ${hit.displayBar.close.toFixed(4)}`
} })
let index = 99999, tick = 0, timer: ReturnType<typeof setInterval> | undefined, disposed = false
const abort = new AbortController()
let removeOverlays: (() => void) | undefined
const bar = (i: number) => {
  const open = 100 + Math.sin(i / 47) * 8, close = 100 + Math.sin((i + 1) / 47) * 8
  return { timestamp: 1700000000000 + i * 60000, open, close, high: Math.max(open, close) + 0.3, low: Math.min(open, close) - 0.3, volume: 100 + i % 99 }
}
chart.setData(Array.from({ length: index + 1 }, (_, i) => bar(i)))
byId('status').textContent = `100,000 synthetic bars loaded in ${(performance.now() - start).toFixed(1)} ms (includes lazy module load; first paint follows).`
const on = (id: string, event: string, fn: () => void) => byId(id).addEventListener(event, fn, { signal: abort.signal })
const update = () => {
  const b = bar(index)
  b.close += Math.sin(++tick / 9) * 0.1
  chart.update(b)
}
on('style', 'change', () => chart.setRenderOptions({ chartType: byId<HTMLSelectElement>('style').value as EngineRenderOptions['chartType'] }))
on('mode', 'change', () => chart.view.setMode(byId<HTMLSelectElement>('mode').value === 'raw' ? 'raw' : 'heikin-ashi'))
const layout = () => chart.setLayout({ priceScale: { mode: byId<HTMLSelectElement>('scale').value as PriceScaleMode, reversed: byId<HTMLInputElement>('reverse').checked } })
on('scale', 'change', layout); on('reverse', 'change', layout)
const indicatorList = () => {
  const select = byId<HTMLSelectElement>('indicator-list')
  select.replaceChildren(...chart.listIndicators().map(item => new Option(`${item.name} (${item.params.join(',')})`, item.id)))
}
indicatorList()
on('add-indicator', 'click', () => { chart.addIndicator({ name: byId<HTMLSelectElement>('indicator').value }); indicatorList() })
on('load-pack', 'click', () => {
  byId<HTMLButtonElement>('load-pack').disabled = true
  void import('@supersolutions/super-chart-core/indicators').then(({ TECHNICAL_INDICATOR_DEFINITIONS }) => {
    if (disposed) return
    for (const definition of TECHNICAL_INDICATOR_DEFINITIONS) {
      chart.registerIndicator(definition)
      byId<HTMLSelectElement>('indicator').add(new Option(definition.name, definition.name))
    }
    byId('load-pack').textContent = 'Technical pack loaded'
  }).catch(error => { if (!disposed) { byId('status').textContent = String(error); byId<HTMLButtonElement>('load-pack').disabled = false } })
})
on('load-classic', 'click', () => {
  byId<HTMLButtonElement>('load-classic').disabled = true
  void import('@supersolutions/super-chart-core/indicators').then(({ CLASSIC_INDICATOR_DEFINITIONS }) => {
    if (disposed) return
    for (const definition of CLASSIC_INDICATOR_DEFINITIONS) {
      chart.registerIndicator(definition)
      byId<HTMLSelectElement>('indicator').add(new Option(definition.name, definition.name))
    }
    byId('load-classic').textContent = 'Classic indicators loaded'
  }).catch(error => { if (!disposed) { byId('status').textContent = String(error); byId<HTMLButtonElement>('load-classic').disabled = false } })
})
on('remove-indicator', 'click', () => { chart.removeIndicator(byId<HTMLSelectElement>('indicator-list').value); indicatorList() })
on('drawing', 'change', () => chart.setDrawingTool(byId<HTMLSelectElement>('drawing').value as DrawingType || null))
on('undo', 'click', () => { chart.drawings.undo() }); on('redo', 'click', () => { chart.drawings.redo() })
on('lock', 'click', () => {
  const state = chart.drawings.getSnapshot(), selected = state.drawings.find(item => item.id === state.selectedId)
  if (selected !== undefined) chart.drawings.update(selected.id, { locked: !selected.locked })
})
on('remove-drawing', 'click', () => { const id = chart.drawings.getSnapshot().selectedId; if (id !== null) chart.drawings.remove(id) })
const stopDrawingReadout = chart.drawings.subscribe(() => {
  const state = chart.drawings.getSnapshot()
  byId('drawings-state').textContent = `${state.drawings.length} drawings · ${state.selectedId ?? 'none selected'} · undo ${state.canUndo} · redo ${state.canRedo}`
})
on('live', 'click', () => {
  if (timer !== undefined) { clearInterval(timer); timer = undefined; byId('live').textContent = 'Start live' }
  else { timer = setInterval(() => { if (tick % 20 === 0) index++; update() }, 50); byId('live').textContent = 'Stop live' }
})
on('burst', 'click', () => chart.updateBatch(Array.from({ length: 300 }, () => bar(++index))))
on('follow', 'click', () => chart.view.followLatest())
on('overlays', 'click', () => {
  if (removeOverlays !== undefined) { removeOverlays(); removeOverlays = undefined; byId('overlays').textContent = 'Show volume profile and zones'; return }
  byId<HTMLButtonElement>('overlays').disabled = true
  void import('@supersolutions/super-chart-web/overlays').then(({ createMarketOverlayLayer }) => {
    if (disposed) return
    removeOverlays = chart.addLayer(createMarketOverlayLayer({ volumeProfile: true, fairValueGaps: true, orderBlocks: true }, { showValueArea: true }))
    byId('overlays').textContent = 'Hide volume profile and zones'
  }).catch(error => { if (!disposed) byId('status').textContent = String(error) })
    .finally(() => { if (!disposed) byId<HTMLButtonElement>('overlays').disabled = false })
})
// The depth and liquidation data below is generated here for the demo only; the chart draws whatever the host passes in.
const toggleLayer = (id: string, label: string, make: () => Promise<{ layer: import('@supersolutions/super-chart-web').EngineLayer, refresh?: () => void }>): void => {
  let remove: (() => void) | undefined
  on(id, 'click', () => {
    if (remove !== undefined) { remove(); remove = undefined; byId(id).textContent = label; return }
    byId<HTMLButtonElement>(id).disabled = true
    void make().then(({ layer }) => {
      if (disposed) return
      remove = chart.addLayer(layer); byId(id).textContent = 'Hide: ' + label
    }).catch(error => { if (!disposed) byId('status').textContent = String(error) })
      .finally(() => { if (!disposed) byId<HTMLButtonElement>(id).disabled = false })
  })
}
toggleLayer('sessions', 'Volume profile per day', async () => {
  const { createMarketOverlayLayer } = await import('@supersolutions/super-chart-web/overlays')
  return { layer: createMarketOverlayLayer({ volumeProfile: { mode: 'session', rows: 40 } }, { showValueArea: true }) }
})
toggleLayer('depth', 'Order-book heatmap (synthetic book)', async () => {
  const { createDepthHeatmapLayer } = await import('@supersolutions/super-chart-web/overlays')
  const layer = createDepthHeatmapLayer()
  // A synthetic book every 20 minutes of the last 3000 minutes: thin liquidity near the price, a few persistent walls.
  const last = 1700000000000 + 99999 * 60000
  layer.setSnapshots(Array.from({ length: 150 }, (_, i) => {
    const t = last - (149 - i) * 20 * 60000, centre = 100 + Math.sin(((99999 - (149 - i) * 20)) / 47) * 8
    const levels: Array<[number, number]> = Array.from({ length: 120 }, (_, k) => [centre - 6 + k * 0.1, 5 + ((k * 7 + i) % 11)])
    levels.push([centre - 2.35, 900], [centre + 3.15, 1300 - (i % 30) * 20])
    return { timestamp: t, levels }
  }))
  return { layer }
})
toggleLayer('liquidations', 'Liquidation map (synthetic levels)', async () => {
  const { createLiquidationMapLayer } = await import('@supersolutions/super-chart-web/overlays')
  const layer = createLiquidationMapLayer({ cumulative: false })
  const close = 100 + Math.sin(100000 / 47) * 8
  layer.setLevels(Array.from({ length: 160 }, (_, k) => { const price = close - 8 + k * 0.1; return price < close ? { price, long: 20 + ((k * 13) % 50) * (1 + Math.max(0, 4 - Math.abs(price - (close - 3)))) } : { price, short: 15 + ((k * 17) % 40) * (1 + Math.max(0, 4 - Math.abs(price - (close + 4)))) } }))
  return { layer }
})
on('export', 'click', () => {
  void chart.snapshot().then(blob => {
    if (disposed) return
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'super-chart-engine.png'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }).catch(error => { if (!disposed) byId('status').textContent = String(error) })
})
const metricsTimer = setInterval(() => { byId('metrics').textContent = JSON.stringify(chart.getMetrics()) }, 200)
function dispose (): void {
  if (disposed) return
  disposed = true; clearInterval(timer); clearInterval(metricsTimer); abort.abort(); stopDrawingReadout(); chart.dispose()
  document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(control => { control.disabled = true })
  byId('status').textContent = 'Disposed; rendering, feed timer and listeners stopped.'
}
on('dispose', 'click', dispose)
window.addEventListener('pagehide', dispose, { signal: abort.signal })
import.meta.hot?.dispose(dispose)
