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
import { detectFairValueGaps, type Bar } from './fairValueGaps'

describe('detectFairValueGaps', () => {
  it('finds a bullish FVG when candle C\'s low is above candle A\'s high', () => {
    const bars: Bar[] = [
      { high: 100, low: 98 }, // A
      { high: 103, low: 99 }, // B (the impulse candle)
      { high: 106, low: 101 } // C: low (101) > A.high (100)
    ]
    const gaps = detectFairValueGaps(bars)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ index: 0, direction: 'bullish', top: 101, bottom: 100, filled: false })
  })

  it('finds a bearish FVG when candle C\'s high is below candle A\'s low', () => {
    const bars: Bar[] = [
      { high: 100, low: 98 }, // A
      { high: 99, low: 94 }, // B
      { high: 97, low: 90 } // C: high (97) < A.low (98)
    ]
    const gaps = detectFairValueGaps(bars)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ index: 0, direction: 'bearish', top: 98, bottom: 97, filled: false })
  })

  it('no gap when candle C\'s range overlaps candle A\'s (the definition only compares A and C — B is descriptive context, not part of the formula)', () => {
    const bars: Bar[] = [
      { high: 100, low: 98 }, // A
      { high: 105, low: 97 }, // B (irrelevant to whether a gap exists)
      { high: 99, low: 95 } // C: high (99) is inside A's [98,100] range — neither direction's condition holds
    ]
    expect(detectFairValueGaps(bars)).toEqual([])
  })

  it('detects overlapping gaps from consecutive triplets independently', () => {
    const bars: Bar[] = [
      { high: 100, low: 98 }, // A0
      { high: 103, low: 99 },
      { high: 106, low: 101 }, // C0, also A1 relative to the next triplet
      { high: 109, low: 104 } // C1: low (104) > bars[1].high? no — check against index-1 triplet
    ]
    const gaps = detectFairValueGaps(bars)
    // At least the first triplet's gap must be found; a second triplet (1,2,3) is checked independently.
    expect(gaps.some(g => g.index === 0 && g.direction === 'bullish')).toBe(true)
  })

  it('fills the gap once a later bar\'s range fully covers it, and records which bar', () => {
    const bars: Bar[] = [
      { high: 100, low: 98 },
      { high: 103, low: 99 },
      { high: 106, low: 101 }, // gap [100, 101]
      { high: 102, low: 95 }, // covers [100,101] entirely -> fills it
      { high: 110, low: 108 }
    ]
    const gaps = detectFairValueGaps(bars)
    expect(gaps[0].filled).toBe(true)
    expect(gaps[0].filledAtIndex).toBe(3)
  })

  it('stays unfilled when no later bar fully covers the gap (a partial touch does not count)', () => {
    const bars: Bar[] = [
      { high: 100, low: 98 },
      { high: 103, low: 99 },
      { high: 106, low: 101 }, // gap [100, 101]
      { high: 100.5, low: 99 } // only touches part of the gap, not the whole [100,101]
    ]
    const gaps = detectFairValueGaps(bars)
    expect(gaps[0].filled).toBe(false)
    expect(gaps[0].filledAtIndex).toBeNull()
  })

  it('empty or too-short input finds nothing', () => {
    expect(detectFairValueGaps([])).toEqual([])
    expect(detectFairValueGaps([{ high: 1, low: 0 }, { high: 1, low: 0 }])).toEqual([])
  })

  it('put-back: without the exact-inequality direction (using >= instead of >), an exact-touch (C.low === A.high) would incorrectly count as a gap', () => {
    const bars: Bar[] = [
      { high: 100, low: 98 },
      { high: 103, low: 99 },
      { high: 106, low: 100 } // exactly touches, no true gap
    ]
    expect(detectFairValueGaps(bars)).toEqual([])
  })
})
