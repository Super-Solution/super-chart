import type { MarketBar } from '../core/types'

/** A checkpoint before/after one bar; the caller owns the source history. */
export interface BollingerState {
  run: number
  valid: boolean
  sinceSeed: number
  sum: number
  compensation: number
  mean: number
  m2: number
}
export type BollingerRow = Readonly<{ basis: number | null, upper: number | null, lower: number | null }>

const EMPTY: BollingerRow = Object.freeze({ basis: null, upper: null, lower: null })
const finite = (value: number): number | null => Number.isFinite(value) ? value : null

export function createBollingerState (): BollingerState {
  return { run: 0, valid: false, sinceSeed: 0, sum: 0, compensation: 0, mean: 0, m2: 0 }
}
export function cloneBollingerState (state: Readonly<BollingerState>): BollingerState { return { ...state } }

function addCompensated (state: BollingerState, value: number): void {
  const next = state.sum + value
  state.compensation += Math.abs(state.sum) >= Math.abs(value) ? (state.sum - next) + value : (value - next) + state.sum
  state.sum = next
}

/**
 * Exact core/ta.bollinger arithmetic over the registry's finite-or-null close
 * field: Neumaier SMA plus population sliding Welford, reseeded every period.
 * Both kernels share the same warmup/reseed cadence for normalized inputs.
 * Process consecutive indices; restore a cloned before-last checkpoint for
 * replacement. Reset state when history before that checkpoint or parameters
 * change. No source history is retained; reseeding reads only one window.
 */
export function stepBollinger (
  bars: readonly MarketBar[], index: number, period: number, multiplier: number, state: BollingerState
): BollingerRow {
  if (!Number.isInteger(period) || period < 1) return EMPTY
  const value = finite(bars[index].close)
  if (value === null) { state.run = 0; state.valid = false; return EMPTY }
  state.run++
  if (state.run < period) return EMPTY
  let deviation: number
  if (!state.valid || ++state.sinceSeed >= period) {
    state.sum = 0; state.compensation = 0
    let plainSum = 0
    for (let i = index - period + 1; i <= index; i++) {
      const close = bars[i].close
      addCompensated(state, close); plainSum += close
    }
    state.mean = plainSum / period; state.m2 = 0
    for (let i = index - period + 1; i <= index; i++) state.m2 += (bars[i].close - state.mean) ** 2
    state.valid = true; state.sinceSeed = 0
    deviation = Math.sqrt(state.m2 / period)
  } else {
    const old = bars[index - period].close
    addCompensated(state, -old); addCompensated(state, value)
    const next = state.mean + (value - old) / period
    state.m2 += (value - old) * (value - next + old - state.mean)
    state.mean = next
    deviation = Math.sqrt(Math.max(state.m2, 0) / period)
  }
  const basis = (state.sum + state.compensation) / period
  return { basis: finite(basis), upper: finite(basis + multiplier * deviation), lower: finite(basis - multiplier * deviation) }
}
