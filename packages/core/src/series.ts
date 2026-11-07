import type { MarketBar } from './types'
import type { Series } from './ta'

/** Nearest timestamp in ascending unique bars; ties select the earlier candle. */
export function nearestBarIndex (bars: ReadonlyArray<Pick<MarketBar, 'timestamp'>>, timestamp: number): number | null {
  if (bars.length === 0 || !Number.isFinite(timestamp)) return null
  let low = 0
  let high = bars.length
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2)
    if (bars[mid].timestamp < timestamp) low = mid + 1
    else high = mid
  }
  if (low === 0) return 0
  if (low === bars.length) return low - 1
  return timestamp - bars[low - 1].timestamp <= bars[low].timestamp - timestamp ? low - 1 : low
}

/** Read only the field an indicator needs; no unused OHLCV arrays. */
export function priceSeries (bars: readonly MarketBar[], field: 'open' | 'high' | 'low' | 'close' | 'volume'): Series {
  const out: Series = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const value = bars[i][field]
    out[i] = typeof value === 'number' ? value : null
  }
  return out
}
