import { ChartWorkspace, registerWorkspaceTheme, listLocales, WORKSPACE_PARTS } from '@supersolutions/super-chart-web'
import type { WorkspaceLayoutMode, WorkspaceIntervalControl, WorkspacePart } from '@supersolutions/super-chart-web'
import type { SymbolInfo, Period, Drawing } from '@supersolutions/super-chart-core'
import pkg from '../../packages/bindings/web/package.json'
import { createFeed, PERIODS, SYMBOLS } from '../_shared/feed'

/**
 * The playground: every public lever of the default workspace in one page, to try an unreleased build before it ships.
 * Nothing here is special to a product: it is the documented API (`ChartWorkspace`, `setTheme`, `setUi`, `ui.variables`).
 */
const feed = createFeed()
const chartHost = document.querySelector<HTMLElement>('#chart')!
const frame = document.querySelector<HTMLElement>('#frame')!
const controls = document.querySelector<HTMLElement>('#controls')!
const statusLine = document.querySelector<HTMLElement>('#status')!
document.querySelector('#version')!.textContent = `web ${pkg.version} (source)`

registerWorkspaceTheme('playground-gold', {
  extends: 'dark',
  chrome: { accent: '#f5a524', focus: '#f5a524', active: 'rgba(245, 165, 36, 0.16)' },
  render: { up: '#2ebd85', down: '#f6465d' }
})

interface State {
  symbol: SymbolInfo, period: Period, theme: string, locale: string, density: 'compact' | 'comfortable'
  layout: WorkspaceLayoutMode, intervals: WorkspaceIntervalControl, headless: boolean, hold: boolean
  parts: Partial<Record<WorkspacePart, boolean>>
  overrides: { accent: string | null, radius: number | null, height: number | null, font: number | null }
}
const state: State = {
  symbol: SYMBOLS[0], period: PERIODS[0], theme: 'dark', locale: 'en', density: 'compact', layout: 'auto', intervals: 'auto',
  headless: false, hold: true, parts: {}, overrides: { accent: null, radius: null, height: null, font: null }
}

let workspace!: ChartWorkspace
const root = (): HTMLElement | null => chartHost.querySelector<HTMLElement>('.sc-workspace')

function applyOverrides (): void {
  const element = root(); if (element === null) return
  const set = (name: string, value: string | null): void => { if (value === null) element.style.removeProperty(name); else element.style.setProperty(name, value) }
  set('--sc-accent', state.overrides.accent); set('--sc-focus', state.overrides.accent)
  set('--sc-radius', state.overrides.radius === null ? null : `${state.overrides.radius}px`)
  set('--sc-control-height', state.overrides.height === null ? null : `${state.overrides.height}px`)
  set('--sc-font-size', state.overrides.font === null ? null : `${state.overrides.font}px`)
}

function mount (): void {
  if (workspace !== undefined) { state.symbol = workspace.getSymbol(); state.period = workspace.getPeriod(); workspace.dispose() }
  workspace = new ChartWorkspace(chartHost, {
    datafeed: feed.datafeed, symbol: state.symbol, period: state.period, periods: PERIODS,
    theme: state.theme, locale: state.locale,
    ui: { density: state.density, layout: state.layout, intervals: state.intervals, headless: state.headless, parts: state.parts },
    chart: { indicators: [{ name: 'MA', params: [20] }, { name: 'VOL' }], drawByHolding: state.hold, render: { timeZone: 'UTC' } }
  })
  applyOverrides()
  workspace.on('loadResult', result => { statusLine.textContent = 'symbol' in result ? `${result.status}: ${result.symbol.ticker} ${result.period.text}` : 'by' in result ? `${result.status} by ${result.by.symbol.ticker} ${result.by.period.text}` : result.status })
  workspace.on('marketChange', change => { state.symbol = change.requested.symbol; state.period = change.requested.period; sync() })
}

// ---- small DOM helpers -------------------------------------------------------------------------------------------
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props); node.append(...children); return node
}
const group = (title: string, ...rows: Node[]): HTMLElement => { const set = el('fieldset', {}, el('legend', {}, title), ...rows); controls.append(set); return set }
const choice = <T extends string>(label: string, values: readonly T[], current: T, change: (value: T) => void): HTMLElement => {
  const select = el('select'); for (const value of values) select.append(el('option', { value, textContent: value }))
  select.value = current; select.addEventListener('change', () => { change(select.value as T) })
  return el('label', {}, label, select)
}
const toggle = (label: string, current: boolean, change: (value: boolean) => void): HTMLElement => {
  const box = el('input', { type: 'checkbox', checked: current }); box.addEventListener('change', () => { change(box.checked) })
  return el('label', {}, label, box)
}
const button = (label: string, run: () => void): HTMLButtonElement => { const b = el('button', { type: 'button', textContent: label }); b.addEventListener('click', run); return b }
const range = (label: string, min: number, max: number, current: number, change: (value: number) => void): HTMLElement => {
  const input = el('input', { type: 'range', min: String(min), max: String(max), value: String(current) }); input.addEventListener('input', () => { change(Number(input.value)) })
  return el('label', {}, label, input)
}

// ---- controls ------------------------------------------------------------------------------------------------------
let symbolSelect: HTMLSelectElement
function sync (): void { if (symbolSelect !== undefined) symbolSelect.value = state.symbol.ticker }

symbolSelect = el('select'); for (const s of SYMBOLS) symbolSelect.append(el('option', { value: s.ticker, textContent: `${s.ticker}: ${s.name}` }))
symbolSelect.addEventListener('change', () => { const next = SYMBOLS.find(s => s.ticker === symbolSelect.value); if (next !== undefined) void workspace.setSymbol(next) })
group('Market',
  el('label', {}, 'Symbol', symbolSelect),
  el('div', { className: 'row' }, ...PERIODS.map(p => button(p.text, () => { void workspace.setPeriod(p) }))),
  toggle('Live ticks', true, value => { feed.setLive(value) }),
  el('div', { className: 'row' }, button('Replay from here', () => { if (!workspace.startReplay()) statusLine.textContent = 'Replay needs loaded bars' }), button('Reload', () => { void workspace.reload() }))
)

group('Look',
  choice('Theme', ['dark', 'light', 'playground-gold'], state.theme, value => { state.theme = value; workspace.setTheme(value); applyOverrides() }),
  choice('Language', listLocales() as readonly string[], state.locale, value => { state.locale = value; workspace.setLocale(value) }),
  choice('Density', ['compact', 'comfortable'] as const, state.density, value => { state.density = value; mount() }),
  choice('Layout', ['auto', 'regular', 'compact', 'narrow'] as const, state.layout, value => { state.layout = value; workspace.setUi({ layout: value }) }),
  choice('Intervals', ['auto', 'bar', 'select'] as const, state.intervals, value => { state.intervals = value; workspace.setUi({ intervals: value }) }),
  toggle('Headless (canvas only)', state.headless, value => { state.headless = value; workspace.setUi({ headless: value }) })
)

group('Width', el('div', { className: 'row' },
  button('Desktop', () => { frame.style.width = '' }), button('Tablet 768', () => { frame.style.width = '768px' }),
  button('Phone 390', () => { frame.style.width = '390px' }), button('Small 320', () => { frame.style.width = '320px' })
), el('small', {}, 'The layout follows the chart’s own width, not the window’s.'))

group('Parts (ui.parts)', ...WORKSPACE_PARTS.map(part => toggle(part, true, value => {
  state.parts = { ...state.parts, [part]: value }; workspace.setUi({ parts: { [part]: value } })
})))

group('Overrides (ui.variables)',
  el('label', {}, '--sc-accent', Object.assign(el('input', { type: 'color', value: '#5b45d6' }), {
    oninput (this: HTMLInputElement) { state.overrides.accent = this.value; applyOverrides() }
  })),
  range('--sc-radius', 0, 16, 6, value => { state.overrides.radius = value; applyOverrides() }),
  range('--sc-control-height', 24, 44, 32, value => { state.overrides.height = value; applyOverrides() }),
  range('--sc-font-size', 11, 16, 13, value => { state.overrides.font = value; applyOverrides() }),
  button('Reset overrides', () => { state.overrides = { accent: null, radius: null, height: null, font: null }; applyOverrides() })
)

const barPoint = (offset: number, key: 'high' | 'low' | 'close'): { timestamp: number, price: number } => {
  const bars = workspace.getBars(), item = bars[Math.max(0, bars.length - 1 - offset)]
  return { timestamp: item.timestamp, price: item[key] }
}
function drawSamples (): void {
  const stamp = Date.now().toString(36)
  const samples: Array<Pick<Drawing, 'type' | 'anchors'>> = [
    { type: 'trend-line', anchors: [barPoint(80, 'low'), barPoint(30, 'high')] },
    { type: 'fibonacci', anchors: [barPoint(70, 'low'), barPoint(20, 'high')] },
    { type: 'rectangle', anchors: [barPoint(45, 'high'), barPoint(15, 'low')] },
    { type: 'horizontal', anchors: [barPoint(0, 'close')] },
    { type: 'parallel-channel', anchors: [barPoint(60, 'low'), barPoint(25, 'low'), barPoint(60, 'high')] }
  ]
  samples.forEach((sample, index) => { try { workspace.chart.drawings.add({ id: `sample-${stamp}-${index}`, ...sample }) } catch (error) { statusLine.textContent = String(error) } })
}
group('Drawings and indicators',
  el('div', { className: 'row' }, button('Draw samples', drawSamples), button('Clear drawings', () => { workspace.chart.drawings.clear() }),
    button('Undo', () => { workspace.chart.drawings.undo() })),
  toggle('Hold to draw', state.hold, value => { state.hold = value; workspace.chart.setDrawByHolding(value) }),
  el('div', { className: 'row' }, ...['EMA', 'BOLL', 'RSI', 'MACD'].map(name => button(`+ ${name}`, () => {
    try { workspace.chart.addIndicator({ name }) } catch (error) { statusLine.textContent = `${name}: ${String(error instanceof Error ? error.message : error)} (load the packs first)` }
  }))),
  button('Load every indicator pack', () => {
    void import('@supersolutions/super-chart-core/indicators').then(pack => {
      for (const definition of pack.TECHNICAL_INDICATOR_DEFINITIONS) workspace.registerIndicator(definition)
      statusLine.textContent = 'Indicator packs registered: open Indicators in the chart'
    })
  })
)

// ---- release checklist and the error counter -----------------------------------------------------------------------
const CHECKS = [
  'Dark and light themes look right; the gold preset recolours accent and candles',
  'Left rail: group button arms a tool, the arrow opens the flyout, Escape closes it',
  'Draw a trend line, a rectangle and a brush stroke; the stroke is smooth and has no dots',
  'Magnet and Keep drawing work; Remove all is one undo step',
  'Every timeframe loads; EMPTY shows no data; BROKEN shows an error with Retry',
  'Phone 390 and Small 320: no horizontal scroll, controls reachable',
  'Replay starts, steps and exits',
  'Indicators: add EMA, BOLL, RSI, MACD; remove one',
  'Overrides (accent, radius, height, font size) change the chrome and reset cleanly',
  'The error counter below stays at 0 through all of the above'
]
const storageKey = `super-chart-playground:${pkg.version}`
const done = ((): boolean[] => { try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as boolean[] } catch { return [] } })()
const errors = el('span', { id: 'errors', textContent: '0' }); errors.dataset.n = '0'
let errorCount = 0
const countError = (): void => { errorCount++; errors.textContent = String(errorCount); errors.dataset.n = String(errorCount) }
window.addEventListener('error', countError); window.addEventListener('unhandledrejection', countError)
const nativeError = console.error.bind(console)
console.error = (...args: unknown[]) => { countError(); nativeError(...args) }
group('Release check (before publishing)',
  ...CHECKS.map((text, index) => {
    const box = el('input', { type: 'checkbox', checked: done[index] === true })
    box.addEventListener('change', () => { done[index] = box.checked; try { localStorage.setItem(storageKey, JSON.stringify(done)) } catch { /* private mode: the list still works */ } })
    return el('label', { className: 'check' }, box, text)
  }),
  el('div', {}, 'Errors seen: ', errors)
)

mount(); sync()
Object.assign(window, { workspace: () => workspace })
