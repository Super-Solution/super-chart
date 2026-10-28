import { describe, expect, it, vi } from 'vitest'

import {
  _resetCountdownRegistrationForTest, attachBarCountdown, barRemaining, buildCountdownOverlayTemplate, formatCountdown,
  nextBarClose, registerCountdownOverlay
} from './countdown'
import type { CountdownChart, RegisterOverlayFn } from './countdown'

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

// ---- attachBarCountdown -----------------------------------------------------

function fakeChart (overrides: Partial<CountdownChart> = {}): CountdownChart & { overlays: Map<string, unknown> } {
  const overlays = new Map<string, unknown>()
  let seq = 0
  return {
    overlays,
    getDataList: () => [{ timestamp: 0, open: 100, close: 105 }],
    getStyles: () => ({ candle: { priceMark: { last: { show: true, upColor: '#0f0', downColor: '#f00', noChangeColor: '#888', text: { show: true, size: 11, paddingTop: 3, paddingBottom: 3 } } } } }),
    createOverlay: (value) => {
      const id = `ov${++seq}`
      overlays.set(id, value)
      return id
    },
    overrideOverlay: ({ id, extendData }) => { overlays.set(id, { ...(overlays.get(id) as object), extendData }) },
    removeOverlay: (remove) => {
      const r = remove as { id?: string } | undefined
      if (r?.id !== undefined) {
        overlays.delete(r.id)
      } else {
        overlays.clear()
      }
    },
    ...overrides
  }
}

function fakeRegisterOverlay (): RegisterOverlayFn {
  return vi.fn()
}

describe('attachBarCountdown', () => {
  it('creates the overlay with the formatted countdown text', () => {
    const chart = fakeChart()
    const now = 0
    const dispose = attachBarCountdown(chart, {
      getPeriod: () => ({ multiplier: 1, timespan: 'hour' }),
      registerOverlay: fakeRegisterOverlay(),
      now: () => now,
      setTimeout: () => 0,
      clearTimeout: () => {}
    })
    expect(chart.overlays.size).toBe(1)
    const [[, overlay]] = chart.overlays
    // now=0, a 1-hour bar opened at 0: barRemaining(0, hour, 0) === one full hour.
    expect((overlay as { extendData: { text: string } }).extendData.text).toBe('01:00:00')
    dispose()
  })

  it('removes the overlay once the bar should have closed, and does not recreate it', () => {
    const chart = fakeChart()
    let now = 0
    const scheduled: { fn: (() => void) | null } = { fn: null }
    const dispose = attachBarCountdown(chart, {
      getPeriod: () => ({ multiplier: 1, timespan: 'hour' }),
      registerOverlay: fakeRegisterOverlay(),
      now: () => now,
      setTimeout: (fn: () => void) => { scheduled.fn = fn; return 1 },
      clearTimeout: () => {}
    })
    expect(chart.overlays.size).toBe(1)
    now = 3_600_001 // the bar has closed
    scheduled.fn?.()
    expect(chart.overlays.size).toBe(0)
    dispose()
  })

  it('re-creates the overlay if a host wipes every overlay while the countdown is still active', async () => {
    const chart = fakeChart()
    const dispose = attachBarCountdown(chart, {
      getPeriod: () => ({ multiplier: 1, timespan: 'hour' }),
      registerOverlay: fakeRegisterOverlay(),
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {}
    })
    expect(chart.overlays.size).toBe(1)
    const [id] = [...chart.overlays.keys()]
    const overlay = chart.overlays.get(id) as { onRemoved?: () => boolean }
    // Simulate a host calling removeOverlay() with no args: klinecharts would
    // remove every overlay and fire onRemoved on each, including ours.
    chart.removeOverlay()
    expect(chart.overlays.size).toBe(0)
    overlay.onRemoved?.()
    // The re-create is queued with queueMicrotask; let it run.
    await Promise.resolve()
    expect(chart.overlays.size).toBe(1)
    dispose()
  })

  it('hides when the last-price tag is turned off', () => {
    const chart = fakeChart({
      getStyles: () => ({ candle: { priceMark: { last: { show: true, upColor: '#0f0', downColor: '#f00', noChangeColor: '#888', text: { show: false, size: 11, paddingTop: 3, paddingBottom: 3 } } } } })
    })
    const dispose = attachBarCountdown(chart, {
      getPeriod: () => ({ multiplier: 1, timespan: 'hour' }),
      registerOverlay: fakeRegisterOverlay(),
      now: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {}
    })
    expect(chart.overlays.size).toBe(0)
    dispose()
  })

  it('dispose removes the overlay and stops the timer', () => {
    const chart = fakeChart()
    const clearTimeout = vi.fn()
    const dispose = attachBarCountdown(chart, {
      getPeriod: () => ({ multiplier: 1, timespan: 'hour' }),
      registerOverlay: fakeRegisterOverlay(),
      now: () => 0,
      setTimeout: () => 'handle',
      clearTimeout
    })
    dispose()
    expect(chart.overlays.size).toBe(0)
    expect(clearTimeout).toHaveBeenCalledWith('handle')
  })
})

describe('buildCountdownOverlayTemplate', () => {
  it('createPointFigures never draws in the main pane', () => {
    expect(buildCountdownOverlayTemplate().createPointFigures()).toEqual([])
  })

  it('createYAxisFigures draws nothing without valid extendData', () => {
    const template = buildCountdownOverlayTemplate()
    expect(template.createYAxisFigures({ overlay: { extendData: undefined }, yAxis: { convertToPixel: v => v }, bounding: { width: 100 } })).toEqual([])
    expect(template.createYAxisFigures({ overlay: { extendData: { text: '' } }, yAxis: { convertToPixel: v => v }, bounding: { width: 100 } })).toEqual([])
    expect(template.createYAxisFigures({ overlay: { extendData: { text: '01:00', price: 100 } }, yAxis: null, bounding: { width: 100 } })).toEqual([])
  })

  it('createYAxisFigures draws one ignoreEvent text figure positioned at the price, offset', () => {
    const template = buildCountdownOverlayTemplate()
    const figures = template.createYAxisFigures({
      overlay: { extendData: { text: '01:00', price: 100, color: '#f00', offset: 5 } },
      yAxis: { convertToPixel: v => v * 2 },
      bounding: { width: 100 }
    })
    expect(figures).toHaveLength(1)
    expect(figures[0].type).toBe('text')
    expect(figures[0].ignoreEvent).toBe(true)
    expect((figures[0].attrs as { x: number, y: number, text: string }).x).toBe(50)
    expect((figures[0].attrs as { x: number, y: number, text: string }).y).toBe(205) // convertToPixel(100) + offset(5)
    expect((figures[0].attrs as { text: string }).text).toBe('01:00')
    expect((figures[0].styles as { backgroundColor: string }).backgroundColor).toBe('#f00')
  })

  it('needs no default figures: it draws only through createYAxisFigures', () => {
    const template = buildCountdownOverlayTemplate()
    expect(template.needDefaultPointFigure).toBe(false)
    expect(template.needDefaultXAxisFigure).toBe(false)
    expect(template.needDefaultYAxisFigure).toBe(false)
  })
})

describe('registerCountdownOverlay', () => {
  it('registers exactly once even when called twice', () => {
    _resetCountdownRegistrationForTest()
    const register = vi.fn()
    registerCountdownOverlay(register)
    registerCountdownOverlay(register)
    expect(register).toHaveBeenCalledTimes(1)
  })
})
