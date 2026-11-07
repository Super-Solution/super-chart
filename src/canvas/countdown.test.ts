import { describe, expect, it, vi } from 'vitest'

import { barRemaining, createBarCountdown, formatCountdown, getBarCountdown, nextBarClose } from '../engine/barCountdown'
import type { CountdownContext } from '../engine/barCountdown'

describe('nextBarClose', () => {
  it('fixed-duration timespans add multiplier * span', () => {
    expect(nextBarClose(0, { multiplier: 1, timespan: 'minute' })).toBe(60_000)
    expect(nextBarClose(0, { multiplier: 4, timespan: 'hour' })).toBe(4 * 3_600_000)
    expect(nextBarClose(0, { multiplier: 1, timespan: 'day' })).toBe(86_400_000)
  })

  it('month/year add a calendar step (handles rollover)', () => {
    const jan31 = Date.UTC(2026, 0, 31) // Jan 31
    // Adding a naive 30 days would land in March; the calendar step lands on the last valid day JS gives (Mar 3, since Feb has 28 days in 2026).
    const close = nextBarClose(jan31, { multiplier: 1, timespan: 'month' })
    expect(close).not.toBeNull()
    expect(new Date(close ?? 0).getUTCMonth()).toBeGreaterThanOrEqual(1) // Feb (1) or later, never December/January
    const oneYear = nextBarClose(Date.UTC(2026, 0, 1), { multiplier: 1, timespan: 'year' })
    expect(oneYear).not.toBeNull()
    expect(new Date(oneYear ?? 0).getUTCFullYear()).toBe(2027)
  })

  it('null for an unknown timespan or a non-positive multiplier', () => {
    expect(nextBarClose(0, { multiplier: 1, timespan: 'fortnight' })).toBeNull()
    expect(nextBarClose(0, { multiplier: 0, timespan: 'minute' })).toBeNull()
    expect(nextBarClose(0, { multiplier: -1, timespan: 'minute' })).toBeNull()
  })
})

describe('barRemaining', () => {
  const period = { multiplier: 1, timespan: 'hour' }

  it('the time left until the bar closes', () => {
    expect(barRemaining(0, period, 10 * 60_000)).toBe(3_600_000 - 10 * 60_000)
  })

  it('null once the bar should have closed (a stale feed or closed market)', () => {
    expect(barRemaining(0, period, 3_600_000)).toBeNull()
    expect(barRemaining(0, period, 3_600_001)).toBeNull()
  })

  it('null when remaining exceeds one period (a feed stamping bars with their close time)', () => {
    // "now" before lastBarTs would give remaining > span.
    expect(barRemaining(3_600_000, period, 0)).toBeNull()
  })

  it('null for an unrecognised timespan', () => {
    expect(barRemaining(0, { multiplier: 1, timespan: 'tick' }, 100)).toBeNull()
  })
})

describe('formatCountdown', () => {
  it('mm:ss under an hour', () => {
    expect(formatCountdown(65_000)).toBe('01:05')
    expect(formatCountdown(0)).toBe('00:00')
  })
  it('HH:MM:SS under a day', () => {
    expect(formatCountdown(3_600_000 + 61_000)).toBe('01:01:01')
  })
  it('Nd HHh above a day', () => {
    expect(formatCountdown(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d 03h')
  })
  it('rounds up to the next second (never shows 00:00 while time remains)', () => {
    expect(formatCountdown(500)).toBe('00:01')
  })
})

// Existing countdown lifecycle cases now exercise the owned timer/model. The
// retired global-overlay registration, private figure and host-overlay-wipe
// cases have no owned API counterpart and are not counted as validation.
function context (overrides: Partial<CountdownContext> = {}): CountdownContext {
  return {
    marketKey: 'test-market',
    lastBar: { timestamp: 0, open: 100, close: 105 },
    period: { multiplier: 1, timespan: 'hour' },
    ...overrides
  }
}

describe('createBarCountdown', () => {
  it('creates the current snapshot with the formatted countdown text', () => {
    const countdown = createBarCountdown({
      getContext: () => context(), onChange: () => {}, now: () => 0,
      timer: { setTimeout: () => 0, clearTimeout: () => {} }
    })
    expect(countdown.getSnapshot()).not.toBeNull()
    expect(countdown.getSnapshot()?.text).toBe('01:00:00')
    countdown.dispose()
  })

  it('removes the snapshot once the bar should have closed, and does not recreate it', () => {
    let now = 0
    const scheduled: { fn: (() => void) | null } = { fn: null }
    const countdown = createBarCountdown({
      getContext: () => context(), onChange: () => {}, now: () => now,
      timer: { setTimeout: fn => { scheduled.fn = fn; return 1 }, clearTimeout: () => {} }
    })
    expect(countdown.getSnapshot()).not.toBeNull()
    now = 3_600_001
    scheduled.fn?.()
    expect(countdown.getSnapshot()).toBeNull()
    countdown.dispose()
  })

  it('hides when the host disables the countdown', () => {
    const countdown = createBarCountdown({
      getContext: () => context({ enabled: false }), onChange: () => {}, now: () => 0,
      timer: { setTimeout: () => 0, clearTimeout: () => {} }
    })
    expect(countdown.getSnapshot()).toBeNull()
    countdown.dispose()
  })

  it('dispose removes the snapshot and stops the timer', () => {
    const clearTimeout = vi.fn()
    const countdown = createBarCountdown({
      getContext: () => context(), onChange: () => {}, now: () => 0,
      timer: { setTimeout: () => 'handle', clearTimeout }
    })
    countdown.dispose()
    expect(countdown.getSnapshot()).toBeNull()
    expect(clearTimeout).toHaveBeenCalledWith('handle')
  })
})

describe('getBarCountdown', () => {
  it('returns nothing without valid source data', () => {
    expect(getBarCountdown(null, 0)).toBeNull()
    expect(getBarCountdown(context({ lastBar: null }), 0)).toBeNull()
    expect(getBarCountdown(context({ lastBar: { timestamp: 0, open: 100, close: NaN } }), 0)).toBeNull()
  })

  it('provides countdown text and its actual price/direction for the renderer', () => {
    const snapshot = getBarCountdown(context({ lastBar: { timestamp: 0, open: 105, close: 100 } }), 3_540_000)
    expect(snapshot?.price).toBe(100)
    expect(snapshot?.text).toBe('01:00')
    expect(snapshot?.direction).toBe('down')
  })
})
