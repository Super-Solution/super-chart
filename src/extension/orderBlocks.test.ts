/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest'
import { detectOrderBlocks, type Bar } from './orderBlocks'

function flat (n: number, price: number): Bar[] {
  return Array.from({ length: n }, () => ({ open: price, high: price + 0.5, low: price - 0.5, close: price }))
}

describe('detectOrderBlocks', () => {
  it('finds a bullish order block: a down candle right before a strong up displacement that breaks the recent swing high', () => {
    const bars = flat(10, 100) // swingLookback window, high 100.5
    const downCandle: Bar = { open: 100.2, high: 100.4, low: 99.5, close: 99.6 } // index 10, a down candle
    const displacement: Bar = { open: 99.6, high: 105, low: 99.5, close: 104.8 } // breaks 100.5 by a lot
    const bars2 = [...bars, downCandle, displacement, ...flat(3, 104.8)]
    const blocks = detectOrderBlocks(bars2, { swingLookback: 10, lookahead: 3, displacementFactor: 1.5 })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ index: 10, direction: 'bullish', breakIndex: 11, high: 100.4, low: 99.5 })
  })

  it('finds a bearish order block: an up candle right before a strong down displacement that breaks the recent swing low', () => {
    const bars = flat(10, 100) // swing low 99.5
    const upCandle: Bar = { open: 99.8, high: 100.5, low: 99.6, close: 100.4 }
    const displacement: Bar = { open: 100.4, high: 100.5, low: 95, close: 95.2 }
    const bars2 = [...bars, upCandle, displacement, ...flat(3, 95.2)]
    const blocks = detectOrderBlocks(bars2, { swingLookback: 10, lookahead: 3, displacementFactor: 1.5 })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ index: 10, direction: 'bearish', breakIndex: 11 })
  })

  it('no block when the move never breaks the swing high/low (a normal continuation, not structure-breaking)', () => {
    const bars = flat(10, 100)
    const downCandle: Bar = { open: 100.2, high: 100.4, low: 99.5, close: 99.6 }
    const smallMove: Bar = { open: 99.6, high: 100.0, low: 99.4, close: 99.9 } // never exceeds 100.5
    const bars2 = [...bars, downCandle, smallMove, ...flat(3, 99.9)]
    expect(detectOrderBlocks(bars2)).toHaveLength(0)
  })

  it('no block when the move breaks structure but is not a strong enough displacement (too small relative to the candidate)', () => {
    const bars = flat(10, 100)
    const downCandle: Bar = { open: 100.2, high: 100.4, low: 100.1, close: 100.15 } // tiny range (0.3)
    // Breaks 100.5 but only just, by less than 1.5x the candidate's own range.
    const weakBreak: Bar = { open: 100.15, high: 100.7, low: 100.1, close: 100.6 }
    const bars2 = [...bars, downCandle, weakBreak, ...flat(3, 100.6)]
    expect(detectOrderBlocks(bars2, { displacementFactor: 1.5 })).toHaveLength(0)
  })

  it('mitigated becomes true once a later close re-enters the block range', () => {
    const bars = flat(10, 100)
    const downCandle: Bar = { open: 100.2, high: 100.4, low: 99.5, close: 99.6 }
    const displacement: Bar = { open: 99.6, high: 105, low: 99.5, close: 104.8 }
    const pullback: Bar = { open: 104.8, high: 104.9, low: 99.9, close: 100.0 } // closes back inside [99.5, 100.4]
    const bars2 = [...bars, downCandle, displacement, pullback]
    const blocks = detectOrderBlocks(bars2, { swingLookback: 10 })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].mitigated).toBe(true)
  })

  it('stays unmitigated while price never returns to the block range', () => {
    const bars = flat(10, 100)
    const downCandle: Bar = { open: 100.2, high: 100.4, low: 99.5, close: 99.6 }
    const displacement: Bar = { open: 99.6, high: 105, low: 99.5, close: 104.8 }
    const bars2 = [...bars, downCandle, displacement, ...flat(5, 110)]
    const blocks = detectOrderBlocks(bars2, { swingLookback: 10 })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].mitigated).toBe(false)
  })

  it('empty or too-short input finds nothing, never throws', () => {
    expect(detectOrderBlocks([])).toEqual([])
    expect(detectOrderBlocks(flat(3, 100))).toEqual([])
  })

  it('put-back: without the displacement-factor check, the "too small" test above would wrongly report a block', () => {
    const bars = flat(10, 100)
    const downCandle: Bar = { open: 100.2, high: 100.4, low: 100.1, close: 100.15 }
    const weakBreak: Bar = { open: 100.15, high: 100.7, low: 100.1, close: 100.6 }
    const bars2 = [...bars, downCandle, weakBreak, ...flat(3, 100.6)]
    // With a permissive factor (any break counts), the same data DOES report a block —
    // proving the strict test above is actually exercising the displacement check.
    expect(detectOrderBlocks(bars2, { displacementFactor: 0 }).length).toBeGreaterThan(0)
  })
})
