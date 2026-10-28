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

// The candle legend (SC-042): klinecharts' default `candle.tooltip.custom` is
// null, which falls back to a hard-coded "Time: … Open: … Volume: …" row, all
// in one grey. This installs a TradingView-style row instead — coloured
// O/H/L/C, a change vs the previous close, no Time (the crosshair tag already
// shows it) and Volume only when there is no separate VOL pane — without
// re-registering anything global: it is set once on the widget's own styles
// (ChartProComponent installs it, and only when the host has not supplied its
// own `candle.tooltip.custom`).
//
// Part of SUPer-Chart (Apache-2.0).

import type { CandleStyle, CandleTooltipCustomCallback, KLineData, TooltipLegend } from 'klinecharts'

export interface LegendPrecision { price: number, volume: number }

export interface LegendLabels {
  open: string
  high: string
  low: string
  close: string
  volume: string
}

/** The subset of `klinecharts.utils` the legend formats numbers with. */
export interface LegendUtils {
  formatPrecision: (value: number | string, precision?: number) => string
  /** 9.8+ only; absent on 9.1.1 (feature-detected by the caller). */
  formatThousands?: (value: number | string, sign: string) => string
  formatFoldDecimal?: (value: number | string, threshold: number) => string
}

export interface LegendContext {
  utils: LegendUtils
  labels: LegendLabels
  /** Read at call time, so a symbol switch is picked up. */
  getPrecision: () => LegendPrecision
  /**
   * Neither getter has a public source to read from: `candle.tooltip.custom`
   * (`CandleTooltipCustomCallback`) is called with only `(data, styles)` in
   * both 9.7.2 and 9.8.12 — unlike an overlay's `createPointFigures`, whose
   * params klinecharts fills in from the chart's own config (see
   * `extension/fibonacciLine.ts`), the candle tooltip callback is never given
   * `thousandsSeparator`/`decimalFoldThreshold`. And the chart instance
   * itself has no public getter for either: `getThousandsSeparator`/
   * `getDecimalFoldThreshold` exist only on klinecharts' internal (not
   * exported) `ChartStore`, never on the public `Chart` interface (verified
   * against `klinecharts/dist/index.d.ts` for both versions) — so a caller
   * that tries `(widget as any).getThousandsSeparator?.()` always gets
   * `undefined`, silently. These fields stay here only for a host (or a
   * future klinecharts version) that can genuinely supply the live value;
   * absent that, `formatLegendNumber` below falls back to klinecharts' own
   * hard-coded defaults, not to a value that happens to disable formatting.
   */
  getThousandsSeparator?: () => string
  getDecimalFoldThreshold?: () => number
  /** True when there is no separate VOL pane, so the legend should show volume. */
  showVolume: () => boolean
}

/**
 * klinecharts' own precision -> thousands -> fold-decimal pipeline (9.8's
 * default `custom` runs the same three). SC-legend-fmt: when
 * `ctx.getThousandsSeparator`/`getDecimalFoldThreshold` are unavailable (see
 * `LegendContext` above — currently always, on every host), this must fall
 * back to the SAME defaults klinecharts' own `ChartStore` uses everywhere
 * else on the chart (axis labels, crosshair, overlays): `','` and `3`
 * (`_thousandsSeparator = ','`, `_decimalFoldThreshold = 3`). The previous
 * fallback (`''`, `0`) silently produced garbage: `formatFoldDecimal`'s fold
 * regex is `\.0{threshold,}[1-9][0-9]*$`, and with `threshold = 0` that
 * matches almost any decimal (zero required leading zeros), so an ordinary
 * price like `90620.30` came back as `90620.0{0}30` instead of `90,620.30`
 * (reported as garbled text in the legend on both 0.0.33 and 0.0.34).
 * klinecharts itself guards against exactly this: an init `decimalFoldThreshold`
 * option is only honoured `if (isNumber(v) && v > 0)`, i.e. `0` is treated as
 * invalid and ignored in favour of the real default.
 */
export function formatLegendNumber (value: number, precision: number, ctx: LegendContext): string {
  let text = ctx.utils.formatPrecision(value, precision)
  if (ctx.utils.formatThousands !== undefined) {
    text = ctx.utils.formatThousands(text, ctx.getThousandsSeparator?.() ?? ',')
  }
  if (ctx.utils.formatFoldDecimal !== undefined) {
    text = ctx.utils.formatFoldDecimal(text, ctx.getDecimalFoldThreshold?.() ?? 3)
  }
  return text
}

export type ChangeDirection = 'up' | 'down' | 'flat'

export interface ChangeInfo {
  /** '' when there is no base to compare against (no previous candle and open === 0, or base is 0). */
  text: string
  direction: ChangeDirection
}

/**
 * `close` vs `prevClose` (the previous candle's close), falling back to
 * `open` when there is no previous candle (the first visible bar). A zero or
 * missing base yields no text rather than Infinity/NaN.
 */
export function candleChange (close: number, open: number, prevClose: number | null): ChangeInfo {
  const base = prevClose ?? open
  if (base === null || base === undefined || !Number.isFinite(base) || base === 0) {
    return { text: '', direction: 'flat' }
  }
  const diff = close - base
  const direction: ChangeDirection = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : ''
  const pct = (Math.abs(diff) / Math.abs(base)) * 100
  return { text: `${sign}${Math.abs(diff).toFixed(2)} (${sign}${pct.toFixed(2)}%)`, direction }
}

function directionColor (direction: ChangeDirection, bar: CandleStyle['bar']): string {
  return direction === 'up' ? bar.upColor : direction === 'down' ? bar.downColor : bar.noChangeColor
}

/** The candle's own O/H/L/C direction (close vs open), for colouring the four values. */
function candleDirection (bar: KLineData): ChangeDirection {
  return bar.close > bar.open ? 'up' : bar.close < bar.open ? 'down' : 'flat'
}

/**
 * Builds a `candle.tooltip.custom` callback (klinecharts' `CandleTooltipCustomCallback`):
 * coloured O/H/L/C, a change row, and Volume only when `showVolume()` is true.
 * Reads precision at call time (`ctx.getPrecision`), so a symbol switch is
 * picked up without re-creating the legend.
 */
export function createCandleLegend (ctx: LegendContext): CandleTooltipCustomCallback {
  return (data, styles) => {
    const { prev, current } = data
    const precision = ctx.getPrecision()
    const fmtPrice = (v: number): string => formatLegendNumber(v, precision.price, ctx)
    const titleColor = styles.tooltip.text.color
    const dir = candleDirection(current)
    const ohlcColor = directionColor(dir, styles.bar)
    const legends: TooltipLegend[] = [
      { title: { text: ctx.labels.open, color: titleColor }, value: { text: fmtPrice(current.open), color: ohlcColor } },
      { title: { text: ctx.labels.high, color: titleColor }, value: { text: fmtPrice(current.high), color: ohlcColor } },
      { title: { text: ctx.labels.low, color: titleColor }, value: { text: fmtPrice(current.low), color: ohlcColor } },
      { title: { text: ctx.labels.close, color: titleColor }, value: { text: fmtPrice(current.close), color: ohlcColor } }
    ]
    const change = candleChange(current.close, current.open, prev?.close ?? null)
    if (change.text !== '') {
      legends.push({ title: { text: '', color: titleColor }, value: { text: change.text, color: directionColor(change.direction, styles.bar) } })
    }
    if (ctx.showVolume()) {
      legends.push({
        title: { text: ctx.labels.volume, color: titleColor },
        value: { text: formatLegendNumber(current.volume ?? 0, precision.volume, ctx), color: titleColor }
      })
    }
    return legends
  }
}
