import type { MarketBar } from '../core/types'
import type { RealtimeSeriesChange } from '../core/realtimeSeries'
import { sma, ema, bollinger, macd, rsi, stochK, type Series } from '../core/ta'
import { createBollingerState, cloneBollingerState, stepBollinger } from './bollinger'
import type { BollingerState } from './bollinger'

export interface IndicatorFigure {
  readonly key: string
  readonly title: string
  readonly color?: string
  readonly type: 'line' | 'bar' | 'circle'
  readonly lineWidth?: number
  readonly dash?: readonly number[]
  /** Histogram origin in indicator units. */
  readonly base?: number
}

export type IndicatorRow = Readonly<Record<string, number | null>>
export type IndicatorPane = 'price' | 'separate'

export interface IndicatorDefinition {
  readonly name: string
  readonly params?: readonly number[]
  readonly pane: IndicatorPane
  readonly figures: readonly IndicatorFigure[]
  /** Pure calculation: one row per input bar, null for unavailable/warmup values. */
  readonly calculate: (bars: readonly MarketBar[], params: readonly number[]) => readonly IndicatorRow[]
  /** Validate a candidate parameter change before an instance is mutated. */
  readonly validateParams?: (params: readonly number[]) => void
}

export interface EngineIndicatorSpec {
  readonly id?: string
  readonly name: string
  readonly params?: readonly number[]
  readonly pane?: IndicatorPane
  /** Share a lower pane with another indicator; omitted gives this instance its own pane. */
  readonly paneId?: string
  readonly visible?: boolean
}

export interface EngineIndicatorInstance {
  readonly id: string
  readonly name: string
  readonly params: readonly number[]
  readonly pane: IndicatorPane
  readonly paneId?: string
  readonly visible: boolean
}

export interface EngineIndicatorResult {
  readonly id: string
  readonly name: string
  readonly pane: IndicatorPane
  readonly paneId?: string
  readonly figures: readonly IndicatorFigure[]
  /** Borrowed current rows, indexed against the complete input series. */
  readonly rows: readonly IndicatorRow[]
}

type BuiltinName = 'MA' | 'EMA' | 'BOLL' | 'VOL' | 'MACD' | 'RSI' | 'KDJ'
type RecursiveName = 'EMA' | 'RSI'
interface RecursiveState { sum: number, count: number, previous: number | null, gain: number, loss: number }
interface RecursiveCache { beforeLast: RecursiveState, afterLast: RecursiveState }
interface MacdState { fast: RecursiveState, slow: RecursiveState, signal: RecursiveState }
interface MacdCache { beforeLast: MacdState, afterLast: MacdState }
interface BollingerCache { beforeLast: BollingerState, afterLast: BollingerState }
interface MovingAverageState { run: number, valid: boolean, sum: number, compensation: number, sinceSeed: number }
interface MovingAverageCache { beforeLast: MovingAverageState, afterLast: MovingAverageState }
interface Entry {
  instance: EngineIndicatorInstance
  definition: IndicatorDefinition
  builtin?: BuiltinName
  result: EngineIndicatorResult | null
  recursive?: RecursiveCache
  macd?: MacdCache
  bollinger?: BollingerCache
  movingAverage?: MovingAverageCache
}

function finite (value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function field (bars: readonly MarketBar[], key: 'close' | 'high' | 'low'): Series {
  const result: Series = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) result[i] = finite(bars[i][key])
  return result
}

function rowsOf (keys: readonly string[], series: readonly Series[]): IndicatorRow[] {
  const rows: IndicatorRow[] = new Array(series[0]?.length ?? 0)
  for (let i = 0; i < rows.length; i++) {
    const row: Record<string, number | null> = Object.create(null)
    for (let j = 0; j < keys.length; j++) row[keys[j]] = finite(series[j][i])
    rows[i] = row
  }
  return rows
}

function volumeRow (bar: MarketBar): IndicatorRow {
  const volume = finite(bar.volume)
  return { volume: volume !== null && volume >= 0 ? volume : null }
}

function initialState (): RecursiveState { return { sum: 0, count: 0, previous: null, gain: 0, loss: 0 } }
function initialMacdState (): MacdState { return { fast: initialState(), slow: initialState(), signal: initialState() } }
function cloneMacdState (state: MacdState): MacdState { return { fast: { ...state.fast }, slow: { ...state.slow }, signal: { ...state.signal } } }

function initialMovingAverageState (): MovingAverageState {
  return { run: 0, valid: false, sum: 0, compensation: 0, sinceSeed: 0 }
}

function addCompensated (state: MovingAverageState, value: number): void {
  const next = state.sum + value
  state.compensation += Math.abs(state.sum) >= Math.abs(value) ? (state.sum - next) + value : (value - next) + state.sum
  state.sum = next
}

/**
 * The core/ta.sum transition and arithmetic order, over the normalized close
 * field. Nonfinite inputs become null before either the full or tail path.
 * Reseeding every period bounds drift without rescanning historical bars.
 */
function movingAverageStep (bars: readonly MarketBar[], index: number, period: number, state: MovingAverageState): number | null {
  const value = finite(bars[index].close)
  if (value === null) { state.run = 0; state.valid = false; return null }
  state.run++
  if (state.run < period) return null
  if (!state.valid || ++state.sinceSeed >= period) {
    state.sum = 0; state.compensation = 0
    for (let i = index - period + 1; i <= index; i++) addCompensated(state, bars[i].close)
    state.sinceSeed = 0
    state.valid = true
  } else {
    addCompensated(state, -bars[index - period].close)
    addCompensated(state, value)
  }
  return finite((state.sum + state.compensation) / period)
}

/** Same arithmetic order and SMA seed as core/ta.ema; not nativeIndicators' first-close seed. */
function recursiveStep (name: RecursiveName, close: number | null, period: number, state: RecursiveState): number | null {
  if (name === 'EMA') {
    if (close === null) return null
    if (state.previous === null) {
      state.sum += close
      state.count++
      if (state.count === period) state.previous = state.sum / period
    } else state.previous = (2 * close + (period - 1) * state.previous) / (period + 1)
    return finite(state.previous)
  }
  // Wilder RSI uses the first `period` changes as its seed, including the
  // existing core's flat-series convention (zero average loss means 100).
  if (close === null) { state.previous = null; return null }
  if (state.previous === null) { state.previous = close; return null }
  const change = close - state.previous
  state.previous = close
  const gain = Math.max(change, 0), loss = Math.max(-change, 0)
  if (state.count < period) {
    state.gain += gain; state.loss += loss; state.count++
    if (state.count < period) return null
    state.gain /= period; state.loss /= period
  } else {
    state.gain = (state.gain * (period - 1) + gain) / period
    state.loss = (state.loss * (period - 1) + loss) / period
  }
  return finite(state.loss === 0 ? 100 : state.gain === 0 ? 0 : 100 - 100 / (1 + state.gain / state.loss))
}

function kdj (bars: readonly MarketBar[], params: readonly number[]): IndicatorRow[] {
  const raw = stochK(field(bars, 'high'), field(bars, 'low'), field(bars, 'close'), params[0])
  const rows: IndicatorRow[] = new Array(bars.length)
  let k = 50, d = 50
  for (let i = 0; i < raw.length; i++) {
    const value = finite(raw[i])
    if (value === null) {
      rows[i] = { k: null, d: null, j: null }
      k = 50; d = 50
      continue
    }
    // KDJ is not STOCH: recursive smoothing seeded at 50, then J = 3K - 2D.
    // A full lookback window is required; a flat valid OHLC window has RSV 0.
    k = ((params[1] - 1) * k + value) / params[1]
    d = ((params[2] - 1) * d + k) / params[2]
    rows[i] = { k: finite(k), d: finite(d), j: finite(3 * k - 2 * d) }
  }
  return rows
}

const BUILTINS: readonly IndicatorDefinition[] = [
  {
    name: 'MA',
    params: [20],
    pane: 'price',
    figures: [{ key: 'ma', title: 'MA', type: 'line' }],
    calculate: (bars, p) => rowsOf(['ma'], [sma(field(bars, 'close'), p[0])])
  },
  {
    name: 'EMA',
    params: [20],
    pane: 'price',
    figures: [{ key: 'ema', title: 'EMA', type: 'line' }],
    calculate: (bars, p) => rowsOf(['ema'], [ema(field(bars, 'close'), p[0])])
  },
  {
    name: 'BOLL',
    params: [20, 2],
    pane: 'price',
    figures: [
      { key: 'basis', title: 'Basis', type: 'line' }, { key: 'upper', title: 'Upper', type: 'line' }, { key: 'lower', title: 'Lower', type: 'line' }
    ],
    calculate: (bars, p) => {
      const result = bollinger(field(bars, 'close'), p[0], p[1])
      return rowsOf(['basis', 'upper', 'lower'], [result.basis, result.upper, result.lower])
    }
  },
  {
    name: 'VOL',
    params: [],
    pane: 'separate',
    figures: [{ key: 'volume', title: 'Volume', type: 'bar' }],
    calculate: bars => bars.map(volumeRow)
  },
  {
    name: 'MACD',
    params: [12, 26, 9],
    pane: 'separate',
    figures: [
      { key: 'dif', title: 'DIF', type: 'line' }, { key: 'dea', title: 'DEA', type: 'line' }, { key: 'hist', title: 'MACD', type: 'bar' }
    ],
    calculate: (bars, p) => {
      const result = macd(field(bars, 'close'), p[0], p[1], p[2])
      return rowsOf(['dif', 'dea', 'hist'], [result.dif, result.dea, result.hist])
    }
  },
  {
    name: 'RSI',
    params: [14],
    pane: 'separate',
    figures: [{ key: 'rsi', title: 'RSI', type: 'line' }],
    calculate: (bars, p) => rowsOf(['rsi'], [rsi(field(bars, 'close'), p[0])])
  },
  {
    name: 'KDJ',
    params: [9, 3, 3],
    pane: 'separate',
    figures: [
      { key: 'k', title: 'K', type: 'line' }, { key: 'd', title: 'D', type: 'line' }, { key: 'j', title: 'J', type: 'line' }
    ],
    calculate: kdj
  }
]

function checkedParams (params: readonly number[], builtin?: BuiltinName): readonly number[] {
  for (const value of params) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('Indicator parameters must be finite numbers')
  }
  if (builtin !== undefined) {
    const count = builtin === 'VOL' ? 0 : builtin === 'BOLL' ? 2 : builtin === 'MACD' || builtin === 'KDJ' ? 3 : 1
    if (params.length !== count) throw new RangeError(`${builtin} requires ${count} parameters`)
    for (let i = 0; i < params.length; i++) {
      if (builtin === 'BOLL' && i === 1) {
        if (params[i] < 0) throw new RangeError('BOLL deviation multiplier must not be negative')
      } else if (!Number.isSafeInteger(params[i]) || params[i] < 1) throw new RangeError('Indicator periods must be positive safe integers')
    }
  }
  return Object.freeze([...params])
}

/**
 * Renderer-free indicator registry. Supply normalized, ascending OHLC bars.
 *
 * Semantics follow the existing owned TA core: MA is SMA, EMA is SMA-seeded,
 * BOLL uses population deviation, RSI is Wilder and MACD hist = DIF - DEA.
 * KDJ uses a full lookback and 50-seeded recursive K/D; it is not STOCH.
 * MA/EMA/RSI take one period per instance (add more instances for more lines).
 * VOL plots reported nonnegative volume only, without invented missing values.
 *
 * Call invalidate for every in-place data change, as emitted by RealtimeSeries.
 * Unchanged data (including availability/viewport changes) reuses result identity.
 * MA/EMA/RSI/MACD retain before/after-last states; tail changes at or after the
 * previous last bar avoid historical recalculation. MA preserves the core's
 * compensated sum and periodic window reseed (amortised O(1) per appended bar;
 * an update at a reseed boundary reads one period). VOL is stateless and
 * recalculates only changed rows. KDJ tail edits read only their lookback window
 * and retain the previous recursive K/D values. BOLL retains compensated mean
 * and Welford variance with the same periodic reseed as the core. Custom
 * definitions still recompute on data changes. Reset/prepend/history
 * corrections always rebuild.
 *
 * Results are borrowed read-only views, not snapshots: a later tail computation
 * can update their rows in place. Custom calculations must not mutate inputs.
 */
export class EngineIndicators {
  private readonly definitions = new Map<string, IndicatorDefinition>()
  private readonly builtinNames = new Set<string>()
  private readonly entries = new Map<string, Entry>()
  private result: readonly EngineIndicatorResult[] = []
  private bars: readonly MarketBar[] | null = null
  private length = 0
  private dataDirty = false
  private structureDirty = false
  private fullReset = false
  private from = Infinity
  private nextId = 1
  private disposed = false

  constructor () {
    for (const definition of BUILTINS) {
      this.register(definition)
      this.builtinNames.add(definition.name)
    }
  }

  register (definition: IndicatorDefinition): void {
    this.assertLive()
    if (typeof definition.name !== 'string' || definition.name.trim() === '') throw new TypeError('Indicator name must not be empty')
    if (this.definitions.has(definition.name)) throw new Error(`Indicator already registered: ${definition.name}`)
    if (definition.pane !== 'price' && definition.pane !== 'separate') throw new TypeError('Invalid indicator pane')
    if (typeof definition.calculate !== 'function' || definition.figures.length === 0) throw new TypeError('Indicator needs figures and a calculation')
    const keys = new Set<string>()
    const figures = definition.figures.map(figure => {
      if (typeof figure.key !== 'string' || figure.key === '' || keys.has(figure.key) || !['line', 'bar', 'circle'].includes(figure.type)) {
        throw new TypeError('Indicator figure keys must be unique and types must be line, bar or circle')
      }
      if (figure.lineWidth !== undefined && (!Number.isFinite(figure.lineWidth) || figure.lineWidth <= 0 || figure.lineWidth > 32)) throw new RangeError('Figure width must be greater than zero and at most 32')
      if (figure.base !== undefined && !Number.isFinite(figure.base)) throw new RangeError('Figure base must be finite')
      if (figure.dash !== undefined && (!Array.isArray(figure.dash) || figure.dash.length > 16 || figure.dash.some(value => !Number.isFinite(value) || value < 0))) throw new RangeError('Invalid figure dash pattern')
      keys.add(figure.key)
      return Object.freeze({ ...figure, ...(figure.dash === undefined ? {} : { dash: Object.freeze([...figure.dash]) }) })
    })
    this.definitions.set(definition.name, Object.freeze({
      ...definition, params: checkedParams(definition.params ?? []), figures: Object.freeze(figures)
    }))
  }

  /** Never remove built-ins or a definition still used by an instance. */
  unregister (name: string, expectedCalculate?: IndicatorDefinition['calculate']): boolean {
    this.assertLive()
    const definition = this.definitions.get(name)
    if (definition === undefined || this.builtinNames.has(name) ||
      (expectedCalculate !== undefined && definition.calculate !== expectedCalculate) ||
      [...this.entries.values()].some(entry => entry.instance.name === name)) return false
    return this.definitions.delete(name)
  }

  add (spec: EngineIndicatorSpec): string {
    this.assertLive()
    const definition = this.definitions.get(spec.name)
    if (definition === undefined) throw new Error(`Unknown indicator: ${spec.name}`)
    const builtin = this.builtinNames.has(spec.name) ? spec.name as BuiltinName : undefined
    const params = checkedParams(spec.params ?? definition.params ?? [], builtin)
    definition.validateParams?.(params)
    const pane = spec.pane ?? definition.pane
    if (pane !== 'price' && pane !== 'separate') throw new TypeError('Invalid indicator pane')
    let id = spec.id
    if (id === undefined) {
      do { id = `indicator-${this.nextId++}` } while (this.entries.has(id))
    }
    if (typeof id !== 'string' || id.trim() === '' || this.entries.has(id)) throw new Error('Indicator id must be nonempty and unique')
    this.validatePlacement(spec)
    const instance = Object.freeze({ id, name: spec.name, params, pane, paneId: spec.paneId, visible: spec.visible ?? true })
    this.entries.set(id, { instance, definition, builtin, result: null })
    this.structureDirty = true
    return id
  }

  update (id: string, changes: Pick<EngineIndicatorSpec, 'params' | 'pane' | 'paneId' | 'visible'>): boolean {
    this.assertLive()
    const entry = this.entries.get(id)
    if (entry === undefined) return false
    this.validatePlacement(changes)
    const pane = changes.pane ?? entry.instance.pane
    if (pane !== 'price' && pane !== 'separate') throw new TypeError('Invalid indicator pane')
    const params = changes.params === undefined ? entry.instance.params : checkedParams(changes.params, entry.builtin)
    entry.definition.validateParams?.(params)
    const instance = Object.freeze({ ...entry.instance, ...changes, pane, params, visible: changes.visible ?? entry.instance.visible })
    const changed = params.length !== entry.instance.params.length || params.some((value, index) => value !== entry.instance.params[index])
    if (changed || instance.visible !== entry.instance.visible) entry.result = null
    else if (entry.result !== null) entry.result = { ...entry.result, pane, paneId: instance.paneId }
    entry.instance = instance; this.structureDirty = true
    return true
  }

  private validatePlacement (spec: Pick<EngineIndicatorSpec, 'paneId' | 'visible'>): void {
    if (spec.paneId !== undefined && (typeof spec.paneId !== 'string' || spec.paneId.trim() === '' || spec.paneId.length > 128)) throw new TypeError('Indicator pane id must be nonempty and at most 128 characters')
    if (spec.visible !== undefined && typeof spec.visible !== 'boolean') throw new TypeError('Indicator visibility must be boolean')
  }

  remove (id: string): boolean {
    this.assertLive()
    const removed = this.entries.delete(id)
    if (removed) this.structureDirty = true
    return removed
  }

  /** Custom formulas may depend on future bars, so offscreen changes can affect visible values. */
  hasCustom (): boolean { return [...this.entries.values()].some(entry => entry.instance.visible && entry.builtin === undefined) }

  list (): readonly EngineIndicatorInstance[] {
    this.assertLive()
    return Array.from(this.entries.values(), entry => entry.instance)
  }

  registeredNames (): readonly string[] { this.assertLive(); return [...this.definitions.keys()] }

  /** Validate a complete document without changing live instances or calculations. */
  validateReplacement (specs: readonly EngineIndicatorSpec[]): void {
    const candidate = this.prepareReplacement(specs)
    candidate.dispose()
  }

  /** Explicit replacement: every spec is accepted before any live instance changes. */
  replace (specs: readonly EngineIndicatorSpec[]): void {
    const candidate = this.prepareReplacement(specs)
    this.entries.clear()
    for (const [id, entry] of candidate.entries) this.entries.set(id, entry)
    this.nextId = candidate.nextId
    this.result = []; this.structureDirty = true; this.fullReset = true
    candidate.dispose()
  }

  private prepareReplacement (specs: readonly EngineIndicatorSpec[]): EngineIndicators {
    this.assertLive()
    if (!Array.isArray(specs) || specs.length > 64) throw new RangeError('At most 64 indicator instances can be restored')
    const candidate = new EngineIndicators()
    candidate.nextId = this.nextId
    try {
      for (const definition of this.definitions.values()) {
        if (!this.builtinNames.has(definition.name)) candidate.register(definition)
      }
      for (const spec of specs) candidate.add(spec)
      return candidate
    } catch (error) { candidate.dispose(); throw error }
  }

  /** Release retained history/results and custom calculation closures. Idempotent. */
  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.entries.clear(); this.definitions.clear(); this.builtinNames.clear()
    this.result = []; this.bars = null; this.length = 0
    this.dataDirty = false; this.structureDirty = false; this.fullReset = false; this.from = Infinity
  }

  invalidate (change: RealtimeSeriesChange): void {
    this.assertLive()
    if (change.kind === 'availability') return
    this.dataDirty = true
    if (change.kind !== 'tail' || !Number.isSafeInteger(change.from) || change.from < 0) this.fullReset = true
    else this.from = Math.min(this.from, change.from)
  }

  compute (bars: readonly MarketBar[]): readonly EngineIndicatorResult[] {
    this.assertLive()
    const changed = this.dataDirty || this.bars !== bars || this.length !== bars.length
    if (!changed && !this.structureDirty) return this.result
    const canTail = this.dataDirty && !this.fullReset && this.bars === bars && bars.length >= this.length && this.from <= this.length
    const from = canTail ? this.from : 0
    const next: EngineIndicatorResult[] = []
    try {
      for (const entry of this.entries.values()) {
        if (!entry.instance.visible) { entry.result = null; continue }
        if (changed || entry.result === null) this.calculate(entry, bars, from, canTail && entry.result !== null)
        next.push(entry.result!)
      }
    } catch (error) {
      // A custom calculation may throw after another entry advanced its tail.
      // Retrying must rebuild from data, not reuse partially advanced state.
      this.dataDirty = true; this.fullReset = true
      throw error
    }
    this.result = next
    this.bars = bars; this.length = bars.length
    this.dataDirty = false; this.structureDirty = false; this.fullReset = false; this.from = Infinity
    return this.result
  }

  private calculate (entry: Entry, bars: readonly MarketBar[], from: number, tail: boolean): void {
    let rows: IndicatorRow[]
    const name = entry.builtin
    if (name === 'MA') {
      const cache = entry.movingAverage
      const resume = tail && cache !== undefined && this.length > 0 && from >= this.length - 1
      const start = resume ? from : 0
      const state = resume ? { ...(from === this.length ? cache.afterLast : cache.beforeLast) } : initialMovingAverageState()
      rows = resume ? entry.result!.rows as IndicatorRow[] : new Array(bars.length)
      let beforeLast = initialMovingAverageState()
      for (let i = start; i < bars.length; i++) {
        if (i === bars.length - 1) beforeLast = { ...state }
        rows[i] = { ma: movingAverageStep(bars, i, entry.instance.params[0], state) }
      }
      if (start === bars.length && cache !== undefined) beforeLast = cache.beforeLast
      entry.movingAverage = { beforeLast, afterLast: state }
    } else if (name === 'EMA' || name === 'RSI') {
      const cache = entry.recursive
      const resume = tail && cache !== undefined && this.length > 0 && from >= this.length - 1
      const start = resume ? from : 0
      const state = resume ? { ...(from === this.length ? cache.afterLast : cache.beforeLast) } : initialState()
      rows = resume ? entry.result!.rows as IndicatorRow[] : new Array(bars.length)
      let beforeLast = initialState()
      const key = name === 'EMA' ? 'ema' : 'rsi'
      for (let i = start; i < bars.length; i++) {
        if (i === bars.length - 1) beforeLast = { ...state }
        rows[i] = { [key]: recursiveStep(name, finite(bars[i].close), entry.instance.params[0], state) }
      }
      // A no-op tail notification must not discard the existing last-bar checkpoint.
      if (start === bars.length && cache !== undefined) beforeLast = cache.beforeLast
      entry.recursive = { beforeLast, afterLast: state }
    } else if (name === 'BOLL') {
      const cache = entry.bollinger
      const resume = tail && cache !== undefined && this.length > 0 && from >= this.length - 1
      const start = resume ? from : 0
      const state = resume ? cloneBollingerState(from === this.length ? cache.afterLast : cache.beforeLast) : createBollingerState()
      rows = resume ? entry.result!.rows as IndicatorRow[] : new Array(bars.length)
      let beforeLast = createBollingerState()
      for (let i = start; i < bars.length; i++) {
        if (i === bars.length - 1) beforeLast = cloneBollingerState(state)
        rows[i] = stepBollinger(bars, i, entry.instance.params[0], entry.instance.params[1], state)
      }
      if (start === bars.length && cache !== undefined) beforeLast = cache.beforeLast
      entry.bollinger = { beforeLast, afterLast: state }
    } else if (name === 'MACD') {
      const cache = entry.macd
      const resume = tail && cache !== undefined && this.length > 0 && from >= this.length - 1
      const start = resume ? from : 0
      const state = resume ? cloneMacdState(from === this.length ? cache.afterLast : cache.beforeLast) : initialMacdState()
      rows = resume ? entry.result!.rows as IndicatorRow[] : new Array(bars.length)
      let beforeLast = initialMacdState()
      const [fastPeriod, slowPeriod, signalPeriod] = entry.instance.params
      for (let i = start; i < bars.length; i++) {
        if (i === bars.length - 1) beforeLast = cloneMacdState(state)
        const close = finite(bars[i].close)
        const fast = recursiveStep('EMA', close, fastPeriod, state.fast)
        const slow = recursiveStep('EMA', close, slowPeriod, state.slow)
        const dif = fast === null || slow === null ? null : fast - slow
        const dea = recursiveStep('EMA', dif, signalPeriod, state.signal)
        rows[i] = { dif: finite(dif), dea: finite(dea), hist: dif === null || dea === null ? null : finite(dif - dea) }
      }
      if (start === bars.length && cache !== undefined) beforeLast = cache.beforeLast
      entry.macd = { beforeLast, afterLast: state }
    } else if (name === 'KDJ' && tail && this.length > 0 && from >= this.length - 1 && from > 0 &&
        entry.result!.rows[from - 1]?.k != null && entry.result!.rows[from - 1]?.d != null) {
      rows = entry.result!.rows as IndicatorRow[]
      const [period, smoothK, smoothD] = entry.instance.params
      let k = rows[from - 1].k as number, d = rows[from - 1].d as number
      for (let i = from; i < bars.length; i++) {
        let high = -Infinity, low = Infinity
        for (let j = Math.max(0, i - period + 1); j <= i; j++) {
          const h = finite(bars[j].high), l = finite(bars[j].low)
          if (h === null || l === null) { high = NaN; break }
          high = Math.max(high, h); low = Math.min(low, l)
        }
        const close = finite(bars[i].close)
        const rsv = close === null || i < period - 1 ? null : finite(high === low ? 0 : 100 * (close - low) / (high - low))
        if (rsv === null) { rows[i] = { k: null, d: null, j: null }; k = 50; d = 50; continue }
        k = ((smoothK - 1) * k + rsv) / smoothK
        d = ((smoothD - 1) * d + k) / smoothD
        rows[i] = { k: finite(k), d: finite(d), j: finite(3 * k - 2 * d) }
      }
    } else if (name === 'VOL') {
      rows = tail ? entry.result!.rows as IndicatorRow[] : new Array(bars.length)
      for (let i = tail ? from : 0; i < bars.length; i++) rows[i] = volumeRow(bars[i])
    } else {
      const calculated = entry.definition.calculate(bars, entry.instance.params)
      if (!Array.isArray(calculated) || calculated.length !== bars.length) throw new RangeError(`${entry.instance.name} must return one row per bar`)
      if (name !== undefined) rows = calculated as IndicatorRow[]
      else {
        rows = new Array(bars.length)
        for (let i = 0; i < bars.length; i++) {
          const row: Record<string, number | null> = Object.create(null)
          for (const figure of entry.definition.figures) row[figure.key] = finite(calculated[i]?.[figure.key])
          rows[i] = row
        }
      }
    }
    entry.result = { id: entry.instance.id, name: entry.instance.name, pane: entry.instance.pane, paneId: entry.instance.paneId, figures: entry.definition.figures, rows }
  }

  private assertLive (): void {
    if (this.disposed) throw new Error('EngineIndicators has been disposed')
  }
}
