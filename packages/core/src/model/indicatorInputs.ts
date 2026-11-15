import type { MarketBar } from '../types'
import type { Series } from '../ta'

export type OwnedKernel = 'MA' | 'EMA' | 'BOLL' | 'VOL' | 'MACD' | 'RSI' | 'KDJ'
type Calculation = (bars: readonly MarketBar[], params: readonly number[]) => unknown
interface KernelPlan { name: OwnedKernel, parameters: (params: readonly number[]) => readonly number[], maKey?: string }
const kernels = new WeakMap<Calculation, KernelPlan>()
/** Internal identity opt-in: a custom definition with the same name is never substituted. */
export function ownedKernel<T extends Calculation> (calculate: T, plan: KernelPlan): T { kernels.set(calculate, plan); return calculate }
export function kernelFor (calculate: Calculation): KernelPlan | undefined { return kernels.get(calculate) }

interface WindowPlan { inputStart: (params: readonly number[], from: number, length: number) => number, outputStart: (params: readonly number[], from: number, length: number) => number }
const windows = new WeakMap<Calculation, WindowPlan>()
/** Only finite-window formulas whose arithmetic is independent of the omitted prefix. */
export function ownedWindow<T extends Calculation> (calculate: T, plan: WindowPlan): T { windows.set(calculate, plan); return calculate }
export function windowFor (calculate: Calculation): WindowPlan | undefined { return windows.get(calculate) }

type Field = 'open' | 'high' | 'low' | 'close' | 'volume'
interface Inputs { bars: readonly MarketBar[], fields: Map<string, Series> }
let inputs: Inputs | undefined
/** Synchronous compute-local scope; nested registries restore their caller's cache. */
export function withIndicatorInputs<T> (bars: readonly MarketBar[], calculate: () => T): T {
  const previous = inputs
  inputs = { bars, fields: new Map() }
  try { return calculate() } finally { inputs = previous }
}
/** Internal owned kernels borrow these arrays without mutating them. Never cache across data edits. */
export function indicatorField (bars: readonly MarketBar[], field: Field, policy: 'raw' | 'finite' | 'volume' = 'raw'): Series {
  const cache = inputs?.bars === bars ? inputs.fields : undefined, key = policy + ':' + field
  const existing = cache?.get(key)
  if (existing !== undefined) return existing
  const result: Series = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const value = bars[i][field]
    result[i] = typeof value !== 'number' || (policy !== 'raw' && !Number.isFinite(value)) || (policy === 'volume' && value < 0) ? null : value
  }
  cache?.set(key, result)
  return result
}
