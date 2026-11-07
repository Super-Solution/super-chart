/**
 * SuperScript's built-in functions: one signature table that the checker, the
 * evaluator and the reference (`superscriptReference()`, which is also the AI
 * system prompt) all read, so the documentation cannot drift from what the
 * language accepts. Part of Super Chart.
 */
import { ta, type Series } from '@supersolutions/super-chart-core'

/** A value during evaluation: a number is constant across bars, a Series varies. */
export type Value = number | Series

/**
 * series: a series or a constant. length: a constant whole number >= min
 * (default 1). count: a constant whole number >= 0. number: a constant.
 */
export type ParamKind = 'series' | 'length' | 'count' | 'number'

export interface ParamSpec { name: string, kind: ParamKind, default?: number, min?: number }

export type PriceSeries = 'open' | 'high' | 'low' | 'close' | 'volume'

export interface BuiltinContext {
  n: number
  series: (name: PriceSeries) => Series
}

type Group = 'ma' | 'osc' | 'vol' | 'volume' | 'trend' | 'range' | 'signal' | 'pivot' | 'math'

export interface Builtin {
  name: string
  params: ParamSpec[]
  groups: Group[]
  /** Appended to the signature in the reference. */
  note?: string
  impl: (args: Value[], ctx: BuiltinContext) => Value
}

/** A constant becomes a series of that value (na when it is not finite). */
export function asSeries (v: Value, n: number): Series {
  if (typeof v !== 'number') return v
  return new Array<number | null>(n).fill(Number.isFinite(v) ? v : null)
}

/**
 * A constant result: NaN (the constant na) when it is not finite, like the
 * series path's null. Otherwise 1/0 stayed Infinity and min()/comparisons
 * used it as a real number.
 */
function finiteOrNa (r: number): number {
  return Number.isFinite(r) ? r : NaN
}

/** f over a value; constants stay constant, non-finite results become na. */
function mapValue (v: Value, f: (x: number) => number): Value {
  if (typeof v === 'number') return Number.isNaN(v) ? NaN : finiteOrNa(f(v))
  return v.map((x) => {
    if (x == null) return null
    const r = f(x)
    return Number.isFinite(r) ? r : null
  })
}

/** f over two values, element-wise; constants stay constant, non-finite results become na. */
export function zipValue (a: Value, b: Value, f: (x: number, y: number) => number, n: number): Value {
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) || Number.isNaN(b) ? NaN : finiteOrNa(f(a, b))
  const out: Series = new Array<number | null>(n).fill(null)
  for (let i = 0; i < n; i++) {
    const x = typeof a === 'number' ? a : a[i]
    const y = typeof b === 'number' ? b : b[i]
    if (x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) continue
    const r = f(x, y)
    out[i] = Number.isFinite(r) ? r : null
  }
  return out
}

const S = (v: Value, ctx: BuiltinContext): Series => asSeries(v, ctx.n)
const N = (v: Value): number => v as number

const src = (name = 'src'): ParamSpec => ({ name, kind: 'series' })
const len = (min = 1, name = 'len'): ParamSpec => ({ name, kind: 'length', min })

function def (name: string, params: ParamSpec[], groups: Group[], impl: Builtin['impl'], note?: string): Builtin {
  const b: Builtin = { name, params, groups, impl }
  if (note !== undefined) b.note = note
  return b
}

const unary = (name: string, f: (x: number) => number): Builtin => def(name, [src('x')], ['math'], (a) => mapValue(a[0], f))

const LIST: Builtin[] = [
  def('sma', [src(), len()], ['ma'], (a, c) => ta.sma(S(a[0], c), N(a[1]))),
  def('ema', [src(), len()], ['ma'], (a, c) => ta.ema(S(a[0], c), N(a[1]))),
  def('wma', [src(), len()], ['ma'], (a, c) => ta.wma(S(a[0], c), N(a[1]))),
  def('rma', [src(), len()], ['ma'], (a, c) => ta.rma(S(a[0], c), N(a[1]))),
  def('hma', [src(), len(2)], ['ma'], (a, c) => ta.hma(S(a[0], c), N(a[1]))),
  def('vwma', [src(), len()], ['ma', 'volume'], (a, c) => ta.vwma(S(a[0], c), c.series('volume'), N(a[1]))),
  def('rsi', [src(), len()], ['osc'], (a, c) => ta.rsi(S(a[0], c), N(a[1]))),
  def('stoch', [len()], ['osc'], (a, c) => ta.stochK(c.series('high'), c.series('low'), c.series('close'), N(a[0])), '%K over close/high/low'),
  def('cci', [len()], ['osc'], (a, c) => ta.cci(c.series('high'), c.series('low'), c.series('close'), N(a[0])), 'over hlc3'),
  def('mfi', [len()], ['osc', 'volume'], (a, c) => ta.mfi(c.series('high'), c.series('low'), c.series('close'), c.series('volume'), N(a[0])), 'over hlc3'),
  def('roc', [src(), len()], ['osc'], (a, c) => ta.roc(S(a[0], c), N(a[1]))),
  def('mom', [src(), len()], ['osc'], (a, c) => ta.mom(S(a[0], c), N(a[1]))),
  def('stdev', [src(), len()], ['vol'], (a, c) => ta.stdev(S(a[0], c), N(a[1]))),
  def('dev', [src(), len()], ['vol'], (a, c) => ta.dev(S(a[0], c), N(a[1]))),
  def('atr', [len()], ['vol'], (a, c) => ta.atr(c.series('high'), c.series('low'), c.series('close'), N(a[0]))),
  def('tr', [], ['vol'], (_a, c) => ta.trueRange(c.series('high'), c.series('low'), c.series('close'))),
  def('obv', [], ['volume'], (_a, c) => ta.obv(c.series('close'), c.series('volume'))),
  def('vwap', [], ['volume'], (_a, c) => ta.vwap(c.series('high'), c.series('low'), c.series('close'), c.series('volume')), 'cumulative from the first bar, no session reset'),
  def('sar', [{ name: 'start', kind: 'number', default: 0.02 }, { name: 'inc', kind: 'number', default: 0.02 }, { name: 'max', kind: 'number', default: 0.2 }], ['trend'],
    (a, c) => ta.sar(c.series('high'), c.series('low'), N(a[0]), N(a[1]), N(a[2]))),
  def('linreg', [src(), len(), { name: 'offset', kind: 'count', default: 0 }], ['trend'], (a, c) => ta.linreg(S(a[0], c), N(a[1]), N(a[2]))),
  def('correlation', [src('a'), src('b'), len()], ['trend'], (a, c) => ta.correlation(S(a[0], c), S(a[1], c), N(a[2]))),
  def('highest', [src(), len()], ['range'], (a, c) => ta.highest(S(a[0], c), N(a[1]))),
  def('lowest', [src(), len()], ['range'], (a, c) => ta.lowest(S(a[0], c), N(a[1]))),
  def('sum', [src(), len()], ['range'], (a, c) => ta.sum(S(a[0], c), N(a[1]))),
  def('cum', [src()], ['range'], (a, c) => ta.cum(S(a[0], c))),
  def('change', [src(), { name: 'len', kind: 'length', min: 1, default: 1 }], ['range'], (a, c) => ta.change(S(a[0], c), N(a[1]))),
  def('crossover', [src('a'), src('b')], ['signal'], (a, c) => ta.crossover(S(a[0], c), S(a[1], c))),
  def('crossunder', [src('a'), src('b')], ['signal'], (a, c) => ta.crossunder(S(a[0], c), S(a[1], c))),
  def('cross', [src('a'), src('b')], ['signal'], (a, c) => ta.cross(S(a[0], c), S(a[1], c))),
  def('barssince', [src('cond')], ['signal'], (a, c) => ta.barssince(S(a[0], c))),
  def('valuewhen', [src('cond'), src(), { name: 'occurrence', kind: 'count', default: 0 }], ['signal'], (a, c) => ta.valuewhen(S(a[0], c), S(a[1], c), N(a[2]))),
  def('pivothigh', [src(), { name: 'left', kind: 'count' }, { name: 'right', kind: 'count' }], ['pivot'], (a, c) => ta.pivot(S(a[0], c), N(a[1]), N(a[2]), 'high')),
  def('pivotlow', [src(), { name: 'left', kind: 'count' }, { name: 'right', kind: 'count' }], ['pivot'], (a, c) => ta.pivot(S(a[0], c), N(a[1]), N(a[2]), 'low')),
  unary('abs', Math.abs),
  unary('sign', Math.sign),
  unary('round', Math.round),
  unary('floor', Math.floor),
  unary('ceil', Math.ceil),
  unary('sqrt', Math.sqrt),
  unary('log', Math.log),
  unary('log10', Math.log10),
  unary('exp', Math.exp),
  def('pow', [src('a'), src('b')], ['math'], (a, c) => zipValue(a[0], a[1], Math.pow, c.n)),
  def('max', [src('a'), src('b')], ['math'], (a, c) => zipValue(a[0], a[1], Math.max, c.n)),
  def('min', [src('a'), src('b')], ['math'], (a, c) => zipValue(a[0], a[1], Math.min, c.n)),
  def('nz', [src('x'), { name: 'replacement', kind: 'series', default: 0 }], ['math'], (a, c) => {
    const x = a[0]
    const r = a[1]
    if (typeof x === 'number') return Number.isFinite(x) ? x : r
    return x.map((v, i) => (v != null ? v : typeof r === 'number' ? (Number.isFinite(r) ? r : null) : r[i]))
  }),
  def('na', [src('x')], ['math'], (a, c) => {
    const x = a[0]
    if (typeof x === 'number') return Number.isFinite(x) ? 0 : 1
    return x.map((v) => (v == null ? 1 : 0))
  })
]

export const BUILTINS: ReadonlyMap<string, Builtin> = new Map(LIST.map((b) => [b.name, b]))

/** Pine names accepted as-is because their arguments match SuperScript's. */
export const PINE_ALIASES: ReadonlyMap<string, string> = new Map([
  ...['sma', 'ema', 'wma', 'rma', 'hma', 'vwma', 'rsi', 'roc', 'mom', 'stdev', 'dev', 'atr', 'tr', 'sar', 'linreg', 'correlation',
    'highest', 'lowest', 'cum', 'change', 'crossover', 'crossunder', 'cross', 'barssince', 'valuewhen', 'pivothigh', 'pivotlow']
    .map((n): [string, string] => [`ta.${n}`, n]),
  ...['abs', 'sign', 'round', 'floor', 'ceil', 'sqrt', 'log', 'log10', 'exp', 'pow', 'max', 'min', 'sum']
    .map((n): [string, string] => [`math.${n}`, n])
])

/** Pine keyword-argument names mapped to SuperScript's. */
export const PINE_ARG_NAMES: ReadonlyMap<string, string> = new Map([['source', 'src'], ['length', 'len']])

/** Pine's named colours (v5 values). */
export const PINE_COLORS: ReadonlyMap<string, string> = new Map([
  ['aqua', '#00BCD4'], ['black', '#363A45'], ['blue', '#2196F3'], ['fuchsia', '#E040FB'], ['gray', '#787B86'],
  ['green', '#4CAF50'], ['lime', '#00E676'], ['maroon', '#880E4F'], ['navy', '#311B92'], ['olive', '#808000'],
  ['orange', '#FF9800'], ['purple', '#9C27B0'], ['red', '#FF5252'], ['silver', '#B2B5BE'], ['teal', '#00897B'],
  ['white', '#FFFFFF'], ['yellow', '#FFEB3B']
].map(([k, v]): [string, string] => [`color.${k}`, v]))

/** Price series a script can read, plus bar_index and time. */
export const SERIES_NAMES: readonly string[] = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'bar_index', 'time']

function signature (b: Builtin): string {
  const ps = b.params.map((p) => (p.default !== undefined && b.name !== 'nz' ? `${p.name}=${p.default}` : p.name))
  return `${b.name}(${ps.join(',')})${b.note !== undefined ? ` (${b.note})` : ''}`
}

const GROUPS: Array<[Group, string, string?]> = [
  ['ma', 'Moving averages'],
  ['osc', 'Oscillators'],
  ['vol', 'Volatility', 'Bollinger via basis=sma(close,len) and stdev(close,len).'],
  ['volume', 'Volume'],
  ['trend', 'Trend'],
  ['range', 'Ranges/aggregates'],
  ['signal', 'Signals'],
  ['pivot', 'Pivots'],
  ['math', 'Math']
]

/** The reference lines generated from the table, one per group. */
export function builtinReferenceLines (): string[] {
  return GROUPS.map(([g, label, extra]) => {
    const fns = LIST.filter((b) => b.groups.includes(g)).map(signature).join(', ')
    return `${label}: ${fns}.${extra !== undefined ? ` ${extra}` : ''}`
  })
}
