// SPDX-License-Identifier: GPL-3.0-or-later
// Pure geometry for the chart types klinecharts has no native CandleType for
// (SC-NEXT #2): Volume Bars, Columns, High-Low, Step Line, HLC Area and
// Baseline. Each is "value space" math only — no canvas, no klinecharts
// import, no pixel conversion — so it is unit-testable without a chart.
// src/charttypes/customSeries.ts turns this into pixels and draws it, using
// the same xAxis/yAxis.convertToPixel idiom as SC_VRVP and SC_SUPERTREND
// (src/indicators): those two files are the precedent for "a candle-pane
// indicator draws the whole visible series itself", which is how these types
// are rendered (the native candle is hidden — fully transparent colours —
// while its high/low still drive the price axis's auto-range, so the plot
// area does not visually jump when a user switches into one of these types).
//

export interface Bar { open: number, high: number, low: number, close: number, volume?: number }

// ---- Columns: a histogram of the close, one column per bar --------------

export interface ColumnExtent { index: number, from: number, to: number, up: boolean }

/**
 * One column per bar, from `baseline` (the previous bar's close, TradingView's
 * "Columns" convention — falls back to the bar's own open for the first bar)
 * to the bar's close.
 */
export function columnExtents (bars: readonly Bar[]): ColumnExtent[] {
  return bars.map((bar, i) => {
    const base = i > 0 ? bars[i - 1].close : bar.open
    return { index: i, from: base, to: bar.close, up: bar.close >= base }
  })
}

// ---- High-Low: a thin vertical tick from low to high, per bar -----------

export interface HighLowExtent { index: number, high: number, low: number, up: boolean }

export function highLowExtents (bars: readonly Bar[]): HighLowExtent[] {
  return bars.map((bar, i) => ({ index: i, high: bar.high, low: bar.low, up: bar.close >= bar.open }))
}

// ---- Step Line: close values as a staircase, two points per bar ---------

export interface StepPoint { index: number, value: number }

/**
 * `bars.length` closes turned into `2n - 1` (index, value) points that, drawn
 * as straight segments in order, form a staircase: flat across each bar at
 * its close, then a vertical jump at the boundary — never a diagonal, which a
 * plain line/area chart would draw between two different close values.
 */
export function stepLinePoints (bars: readonly Bar[]): StepPoint[] {
  const points: StepPoint[] = []
  bars.forEach((bar, i) => {
    if (i > 0) points.push({ index: i, value: bars[i - 1].close })
    points.push({ index: i, value: bar.close })
  })
  return points
}

// ---- HLC Area: the (H+L+C)/3 typical price, as a filled line ------------

export function typicalPrice (bar: Bar): number {
  return (bar.high + bar.low + bar.close) / 3
}

export function hlcAreaPoints (bars: readonly Bar[]): StepPoint[] {
  return bars.map((bar, index) => ({ index, value: typicalPrice(bar) }))
}

// ---- Baseline: an area split into above/below segments at a reference ---

export interface BaselineSegment {
  /** Inclusive start/end index into `bars` for one contiguous same-side run. */
  from: number
  to: number
  above: boolean
}

/**
 * Splits `bars` (by close, vs. `baseline`) into contiguous above/below runs,
 * each with one extra boundary point at both ends so two adjacent segments'
 * fills meet exactly at their true crossing value rather than at whichever
 * bar's close happens to straddle the line — the crossing is computed by
 * linear interpolation between the two closes, the same way a real baseline
 * series (TradingView's, klinecharts' own line-with-baseline in other
 * products) avoids a visible seam at the flip.
 */
export function baselineSegments (bars: readonly Bar[], baseline: number): BaselineSegment[] {
  if (bars.length === 0) return []
  const segments: BaselineSegment[] = []
  let start = 0
  let above = bars[0].close >= baseline
  for (let i = 1; i < bars.length; i++) {
    const nowAbove = bars[i].close >= baseline
    if (nowAbove !== above) {
      segments.push({ from: start, to: i - 1, above })
      start = i - 1 // the crossing bar's own segment starts at the previous index so fills touch, no gap.
      above = nowAbove
    }
  }
  segments.push({ from: start, to: bars.length - 1, above })
  return segments
}

/** Linear-interpolated close between bars[i] and bars[i+1] at fractional index `t` in [0, 1] — used to place the exact crossing point at the baseline value. */
export function interpolatedClose (bars: readonly Bar[], i: number, t: number): number {
  const a = bars[i]?.close
  const b = bars[i + 1]?.close
  if (a === undefined) return NaN
  if (b === undefined) return a
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

// ---- Volume-coloured bars: relative intensity for each OHLC bar ---------

/**
 * 0..1 relative volume for each bar (linear against the visible range's max
 * volume; 0 for a range with no volume at all), used to scale an OHLC bar's
 * opacity/saturation so heavier bars read as visually heavier — the same
 * "weight by volume" idea percept.one's footprint view uses, without needing
 * bid/ask data.
 */
export function volumeIntensities (bars: readonly Bar[]): number[] {
  const max = bars.reduce((m, b) => Math.max(m, b.volume ?? 0), 0)
  if (max <= 0) return bars.map(() => 0)
  return bars.map(b => Math.max(0, Math.min(1, (b.volume ?? 0) / max)))
}

/** Candle and histogram bodies track their slot width at every zoom level. */
export function halfBarWidth (model: { geometry: { plotWidth: number }, xPositions: readonly number[] }, slotWidth?: number): number {
  let spacing = slotWidth !== undefined && Number.isFinite(slotWidth) && slotWidth > 0 ? slotWidth : model.geometry.plotWidth
  for (let i = 1; i < model.xPositions.length; i++) {
    const gap = model.xPositions[i] - model.xPositions[i - 1]
    if (gap > 0) spacing = Math.min(spacing, gap)
  }
  return Math.max(0.25, spacing * 0.34)
}
