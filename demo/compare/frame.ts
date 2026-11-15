import type { MarketBar, SymbolInfo, Period, Datafeed } from '@supersolutions/super-chart-core'

const startHeap = (performance as any).memory?.usedJSHeapSize ?? null
const params = new URLSearchParams(location.search)
const version = params.get('version') === 'old' ? 'old' : 'new'
const count = [1000, 10000, 50000].includes(Number(params.get('count'))) ? Number(params.get('count')) : 10000
const multi = params.get('multi') === '1'
const initialPeriod = Number(params.get('period')) === 15 ? 15 : 1
const generation = params.get('generation')
const symbols: SymbolInfo[] = [
  { ticker: 'SUI-SIM', name: 'SUI / USD · Synthetic', shortName: 'SUI / USD', exchange: 'DEMO', market: 'crypto', pricePrecision: 4, volumePrecision: 0 },
  { ticker: 'BTC-SIM', name: 'BTC / USD · Synthetic', shortName: 'BTC / USD', exchange: 'DEMO', market: 'crypto', pricePrecision: 2, volumePrecision: 0 }
]
const periods: Period[] = [{ multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 15, timespan: 'minute', text: '15m' }]
const symbol = symbols[params.get('symbol') === 'BTC' ? 1 : 0]
const period = periods[initialPeriod === 15 ? 1 : 0]
const anchor = Date.UTC(2026, 10, 14, 12)
const directBench = params.get('bench') === '1'
let benchRecord: Record<string, any> = { version, engine: params.get('engine'), count }
const loadPhases: Record<string, number> = { historyGenerationMs: 0 }
let benchOutput: HTMLElement | undefined
let seq = 0
let workspace: any
let currentSubscription: { symbol: SymbolInfo, period: Period, callback: (bar: MarketBar) => void } | null = null
let disposed = false
const duration = (p: Period) => p.multiplier * ({ minute: 60000, hour: 3600000, day: 86400000 }[p.timespan] ?? 60000)
function noise(index: number) {
  let x = (index ^ 0x51F15E) >>> 0
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5
  return (x >>> 0) / 4294967296 - 0.5
}
function candle(s: SymbolInfo, timestamp: number, p: Period, phase = 1): MarketBar {
  const i = timestamp / duration(p)
  const base = s.ticker === 'BTC-SIM' ? 86000 : 2.35
  const closeAt = (j: number) => base * (1 + Math.sin(j * 0.019) * 0.06 + Math.sin(j * 0.17) * 0.012 + noise(j) * 0.007)
  const open = closeAt(i - 1)
  const close = open + (closeAt(i) - open) * phase + Math.sin(phase * Math.PI) * base * noise(i + 3) * 0.004
  const wick = base * (0.001 + Math.abs(noise(i + 7)) * 0.002) * phase
  return { timestamp, open, close, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick, volume: Math.round((500 + Math.abs(noise(i + 11)) * 6000) * phase) }
}
function latest(s: SymbolInfo, p: Period) {
  const step = duration(p), base = Math.floor(anchor / step) * step
  return candle(s, base + Math.ceil(seq / 20) * step, p, seq === 0 ? 1 : ((seq - 1) % 20 + 1) / 20)
}
function report(type: string, extra: Record<string, unknown> = {}) {
  if (directBench && benchOutput) {
    if (type === 'ready') { Object.assign(benchRecord, extra, {heapAfterLoad:extra.heap}); benchOutput.textContent=JSON.stringify(benchRecord,null,2); const b=document.querySelector<HTMLButtonElement>('#measure-direct'); if(b)b.disabled=false }
    if (type === 'progress') document.querySelector('#bench-progress')!.textContent=String(extra.name)+' '+String(extra.step)
    if (type === 'measurement') { Object.assign(benchRecord,extra); document.querySelector('#bench-progress')!.textContent='完成'; benchOutput.textContent=JSON.stringify(benchRecord,null,2) }
    if (type === 'error') benchOutput.textContent=String(extra.message)
  }
  parent.postMessage({ channel: 'super-chart-compare', version, generation, type, ...extra }, location.origin)
}
const feed: Datafeed = {
  async searchSymbols(query) { return symbols.filter(s => s.ticker.toLowerCase().includes(query.toLowerCase())) },
  async getHistoryKLineData(s, p, _from, _to, request) {
    if (request?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (request?.firstDataRequest === false) return { bars: [], noData: true }
    const began = performance.now()
    const last = latest(s, p), step = duration(p), bars: MarketBar[] = []
    for (let index = count - 1; index >= 0; index--) bars.push(index === 0 ? last : candle(s, last.timestamp - index * step, p))
    loadPhases.historyGenerationMs += performance.now() - began
    return { bars, noData: true }
  },
  subscribe(s, p, callback) { currentSubscription = { symbol: s, period: p, callback }; report('market', { market: s.ticker + ' / ' + p.text, close: latest(s, p).close, seq }) },
  unsubscribe(s, p) {
    if (currentSubscription?.symbol.ticker === s.ticker && currentSubscription.period.multiplier === p.multiplier && currentSubscription.period.timespan === p.timespan) currentSubscription = null
  }
}
async function loadScript(src: string) {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src; script.onload = () => resolve(); script.onerror = () => reject(new Error('Cannot load ' + src)); document.head.append(script)
  })
}
function setLegacyRange() {
  const chart = workspace.getChart()
  const plotWidth = chart.getSize?.('candle_pane', 'main')?.width ?? document.querySelector('#chart')!.clientWidth - 110
  chart.setOffsetRightDistance(0); chart.setBarSpace(Math.max(2, plotWidth / 159))
  chart.scrollToRealTime(0)
}
async function boot() {
  let constructionStart = 0, constructedAt = 0
  const importStart = performance.now()
  if (version === 'new') {
    const { ChartWorkspace } = await import(params.get('engine') === 'before' ? '/owned-before.js' : '/owned-after.js')
    loadPhases.moduleLoadMs = performance.now() - importStart
    constructionStart = performance.now()
    workspace = new ChartWorkspace(document.querySelector('#chart') as HTMLElement, {
      symbol, period, periods, datafeed: feed, loader: { count },
      countdown: { enabled: false },
      chart: { count: 160, render: { timeZone: 'UTC' }, indicators: multi
        ? [{ name: 'MA', params: [20] }, { name: 'EMA', params: [21] }, { name: 'BOLL', params: [20, 2] }, { name: 'VOL' }, { name: 'RSI', params: [14] }]
        : [{ name: 'MA', params: [20] }, { name: 'VOL' }] }
    })
  } else {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/legacy.css'; document.head.append(css)
    await loadScript('/legacy-engine.js'); await loadScript('/legacy-pro.js')
    loadPhases.moduleLoadMs = performance.now() - importStart
    constructionStart = performance.now()
    workspace = new (window as any).klinechartspro.SuperChart({
      container: document.querySelector('#chart'), symbol, period, periods, datafeed: feed,
      theme: 'dark', locale: 'en-US', timezone: 'UTC', mainIndicators: [], subIndicators: [],
      motion: true
    })
  }
  constructedAt = performance.now()
  loadPhases.constructorMs = constructedAt - constructionStart
  await workspace.ready
  const readyAt = performance.now()
  loadPhases.constructorToReadyMs = readyAt - constructionStart
  loadPhases.afterConstructorToReadyMs = readyAt - constructedAt
  if(params.get('inspect')==='1'){
    const hud=document.createElement('output');hud.id='inspection';hud.style.cssText='position:fixed;right:8px;bottom:3px;background:#101820;color:#e9f2ff;z-index:999;font:11px monospace;pointer-events:none;padding:5px';document.body.append(hud);
    const inspectTimer=setInterval(()=>{if(disposed){clearInterval(inspectTimer);return}const v=workspace.chart?.view.getSnapshot().viewport??workspace.getChart().getVisibleRange();hud.textContent=JSON.stringify({range:v,canvasBytes:[...document.querySelectorAll('canvas')].reduce((n,c)=>n+c.width*c.height*4,0)})},100);
  }
  const state = workspace.getLoadState()
  if (state.status === 'error' || state.loaded == null) throw new Error(state.error?.message ?? 'Data load: ' + state.status)
  if (version === 'old') {
    workspace.addIndicator('MA', { pane: 'main', calcParams: [20] })
    if (multi) { workspace.addIndicator('EMA', { pane: 'main', calcParams: [21] }); workspace.addIndicator('BOLL', { pane: 'main', calcParams: [20, 2] }) }
    workspace.addIndicator('VOL', { pane: 'new', calcParams: [], height: 110 })
    if (multi) workspace.addIndicator('RSI', { pane: 'new', calcParams: [14], height: 100 })
    setLegacyRange()
  }
  // Retain the historical field as navigation-relative, not constructor duration.
  benchRecord.constructReadyMs = performance.now()
  benchRecord.navigationToReadyMs = readyAt
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  loadPhases.readyToPaintObservationMs = performance.now() - readyAt
  benchRecord.loadPhases = loadPhases
  benchRecord.initialFrame = workspace.chart?.getMetrics?.() ?? null
  report('ready', { loadMs: performance.now(), heap: (performance as any).memory?.usedJSHeapSize ?? null, heapStart: startHeap, count: workspace.getBars().length, close: latest(symbol, period).close, seq, market: symbol.ticker + ' / ' + period.text })
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.channel !== 'super-chart-compare' || event.data.generation !== generation || disposed || !workspace) return
  try {
    const msg = event.data
    if (msg.type === 'measure') { void measure().catch(error => report('error', {message:String(error)})); return }
    if (msg.type === 'tick') {
      seq = msg.seq
      if (currentSubscription) {
        const { symbol: s, period: p, callback } = currentSubscription
        const bar = latest(s, p); callback(bar)
        report('tick', { seq, close: bar.close, market: s.ticker + ' / ' + p.text })
      }
    } else if (msg.type === 'replay') {
      version === 'old' ? workspace.replay.exit() : workspace.exitReplay(); const bars = workspace.getBars()
      const started = version === 'old' ? workspace.replay.start({ index: Math.max(0, bars.length - 180) }) : workspace.startReplay(Math.max(0, bars.length - 180)); if (!started) throw new Error('Could not start replay')
      version === 'old' ? workspace.replay.play({ speed: 4 }) : workspace.playReplay(4)
      report('replay')
    } else if (msg.type === 'exitReplay') { version === 'old' ? workspace.replay.exit() : workspace.exitReplay(); report('exitReplay') }
    else if (msg.type === 'latest') {
      if (version === 'old') setLegacyRange()
      else workspace.chart.view.followLatest()
    }
  } catch (error) { report('error', { message: String(error) }) }
})
window.addEventListener('error', event => report('error', { message: event.message }))
window.addEventListener('unhandledrejection', event => report('error', { message: String(event.reason) }))
window.addEventListener('pagehide', () => { disposed = true; currentSubscription = null; workspace?.dispose() })
if(directBench){
  const panel=document.createElement('div');panel.style.cssText='position:fixed;left:0;right:0;bottom:0;height:160px;overflow:auto;background:#15202d;color:#edf3fa;padding:8px;font:12px monospace;z-index:1000';
  panel.innerHTML='<button id="measure-direct" disabled>開始量測</button> <a href="/bench.html" style="color:#acd0ff">切換量測版本</a> <span id="bench-progress"></span><pre id="bench-output"></pre>';document.body.append(panel);
  benchOutput=panel.querySelector('pre')!;document.querySelector<HTMLElement>('#chart')!.style.height='calc(100% - 160px)';
  panel.querySelector('button')!.onclick=async()=>{const button=panel.querySelector('button')!;button.disabled=true;try{await measure()}catch(error){report('error',{message:String(error)})}finally{button.disabled=false}};
}
boot().catch(error => {
  const el = document.createElement('div'); el.id = 'error'; el.textContent = String(error)
  document.body.replaceChildren(el); report('error', { message: String(error) })
})

async function measure() {
 const results: any[] = []
 const sample = async (name: string, action: (i:number)=>void, frames = 180) => {
   const gaps:number[]=[], work:number[]=[], render:number[]=[]
   let previous=performance.now(); const sampleStart=previous; let visibleThroughout=!document.hidden
   for(let i=0;i<(name==='live50Hz'?10000:frames);i++) {
     if(performance.now()-sampleStart>=4000) break
     if(i%30===0)report('progress',{name,step:i,elapsedMs:performance.now()-sampleStart})
     await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Animation frame stalled; keep the measurement tab visible')),5000);requestAnimationFrame(()=>{clearTimeout(timeout);resolve()})})
     visibleThroughout=visibleThroughout&&!document.hidden; const now=performance.now(); if(i>3)gaps.push(now-previous);previous=now
     const begin=performance.now();action(i);work.push(performance.now()-begin); if(version==='new')render.push(workspace.chart.getMetrics().lastFrameMs)
   }
   const pct=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.floor((xs.length-1)*p)]
   return {name,visible:document.visibilityState,visibleThroughout,elapsedMs:performance.now()-sampleStart,frames:gaps.length+4,p50FrameMs:pct(gaps,.5),p95FrameMs:pct(gaps,.95),p95CallMs:pct(work,.95),p95RenderCpuMs:render.length?pct(render,.95):null,range:version==='old'?workspace.getChart().getVisibleRange():workspace.chart.view.getSnapshot().viewport,over25ms:gaps.filter(n=>n>25).length,maxFrameMs:Math.max(...gaps)}
 }
 const bars=workspace.getBars().length, k=version==='old'?workspace.getChart():null
 const range=(end:number,span:number)=>{
   if(k){const width=k.getSize('candle_pane','main').width;k.setBarSpace(width/(span-1));k.scrollToDataIndex(end,0)}
   else workspace.chart.view.setViewport({i0:end-span+1,i1:end})
 }
 range(bars-1,160)
 results.push(await sample('pan',i=>range(bars-1-150+Math.sin(i/25)*100,160)))
 results.push(await sample('zoom',i=>range(bars-1-100,160+Math.sin(i/20)*110)))
 range(bars-1,160)
 if(k)k.scrollToRealTime(0);else workspace.chart.view.followLatest(160)
 // Tail updates use the real feed pipeline. Report actual deliveries, not promised FPS.
 let updates=0;const started=performance.now()
 const timer=setInterval(()=>{seq++;if(currentSubscription){currentSubscription.callback(latest(currentSubscription.symbol,currentSubscription.period));updates++}},20)
 try{results.push(await sample('live50Hz',()=>{},240))}finally{clearInterval(timer)}
 report('measurement',{results,updates,canvasLayers:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height})),updateElapsedMs:performance.now()-started,heap:(performance as any).memory?.usedJSHeapSize??null,canvasBytes:[...document.querySelectorAll('canvas')].reduce((sum,c)=>sum+c.width*c.height*4,0),width:innerWidth,height:innerHeight,dpr:devicePixelRatio})
}
