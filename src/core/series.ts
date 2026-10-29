import type { MarketBar } from './types'
import type { Series } from './ta'

/** Read only the field an indicator needs; no unused OHLCV arrays. */
export function priceSeries (bars: readonly MarketBar[], field: 'open' | 'high' | 'low' | 'close' | 'volume'): Series {
  const out: Series = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const value = bars[i][field]
    out[i] = typeof value === 'number' ? value : null
  }
  return out
}
