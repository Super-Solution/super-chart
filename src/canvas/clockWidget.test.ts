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

// attachClockWidget itself touches the real DOM (document.createElement) and
// is verified in e2e/tests/motion.spec.ts, not here — this file covers the
// two pure functions, the same split navigation.ts and countdown.ts use.

import { describe, expect, it } from 'vitest'
import { formatClock, otherMode } from './clockWidget'

describe('formatClock', () => {
  it('formats UTC as HH:MM:SS, zero-padded', () => {
    const t = Date.UTC(2026, 8, 28, 5, 3, 9)
    expect(formatClock(t, 'utc')).toBe('05:03:09')
  })

  it('midnight and end-of-day boundaries', () => {
    expect(formatClock(Date.UTC(2026, 0, 1, 0, 0, 0), 'utc')).toBe('00:00:00')
    expect(formatClock(Date.UTC(2026, 0, 1, 23, 59, 59), 'utc')).toBe('23:59:59')
  })

  it('local mode reads the Date object\'s local getters (verified via the UTC/local offset agreeing with the JS Date itself, so this passes in any test-runner timezone)', () => {
    const t = Date.UTC(2026, 8, 28, 12, 30, 45)
    const d = new Date(t)
    const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
    expect(formatClock(t, 'local')).toBe(expected)
  })
})

describe('otherMode', () => {
  it('toggles utc <-> local', () => {
    expect(otherMode('utc')).toBe('local')
    expect(otherMode('local')).toBe('utc')
  })
})
