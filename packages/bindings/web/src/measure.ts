// SPDX-License-Identifier: GPL-3.0-or-later
import { colors, CANVAS_LABEL_FONT, CANVAS_FONT } from './tokens'

/** A point on the chart: a bar time and a price. */
export interface MeasurePoint { readonly timestamp: number, readonly price: number }

export interface Measurement {
  /** End price minus start price. */
  readonly change: number
  /** The change as a share of the start price, in percent; null when the start price is zero. */
  readonly percent: number | null
  /** Bars after the start, up to and including the one at the end time; negative when the end is earlier. */
  readonly bars: number
  /** End time minus start time, in milliseconds. */
  readonly duration: number
}

/** How many of `bars` (in time order) have a timestamp in (from, to]. */
function barsBetween (bars: ReadonlyArray<{ readonly timestamp: number }>, from: number, to: number): number {
  const upTo = (time: number): number => {
    let lo = 0, hi = bars.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].timestamp <= time) lo = mid + 1; else hi = mid }
    return lo
  }
  return upTo(to) - upTo(from)
}

/** The timestamp of the bar nearest `time`, or `time` itself when there are no bars. Bars are in time order. */
export function nearestBarTime (bars: ReadonlyArray<{ readonly timestamp: number }>, time: number): number {
  if (bars.length === 0) return time
  let lo = 0, hi = bars.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].timestamp < time) lo = mid + 1; else hi = mid }
  const after = bars[Math.min(lo, bars.length - 1)].timestamp, before = bars[Math.max(0, lo - 1)].timestamp
  return Math.abs(after - time) < Math.abs(time - before) ? after : before
}

/** What a quick measure between two points reports: the price change, its percentage, the bars spanned and the time. */
export function measureBetween (a: MeasurePoint, b: MeasurePoint, bars: ReadonlyArray<{ readonly timestamp: number }>): Measurement {
  const change = b.price - a.price
  return Object.freeze({
    change,
    percent: a.price === 0 ? null : change / Math.abs(a.price) * 100,
    bars: a.timestamp <= b.timestamp ? barsBetween(bars, a.timestamp, b.timestamp) : -barsBetween(bars, b.timestamp, a.timestamp),
    duration: b.timestamp - a.timestamp
  })
}

/** 90 s reads `1m 30s`, 4 500 000 ms `1h 15m`, two days and a half `2d 12h`; the two largest units that are not zero. */
export function formatDuration (milliseconds: number): string {
  const total = Math.round(Math.abs(milliseconds) / 1000)
  if (total === 0) return '0s'
  const units: Array<[string, number]> = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]
  const parts: string[] = []
  let rest = total
  for (const [name, size] of units) {
    const count = Math.floor(rest / size)
    rest -= count * size
    if (count > 0) parts.push(`${count}${name}`)
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

export interface MeasureLabels { readonly bars: (count: number) => string }

/** The two lines of the label: the price change, then the bars and time. */
export function measureLines (m: Measurement, format: (value: number) => string, labels: MeasureLabels): [string, string] {
  const sign = m.change > 0 ? '+' : m.change < 0 ? '−' : ''
  const percent = m.percent === null ? '' : ` (${sign}${Math.abs(m.percent).toFixed(2)}%)`
  return [`${sign}${format(Math.abs(m.change))}${percent}`, `${labels.bars(Math.abs(m.bars))}, ${formatDuration(m.duration)}`]
}

/**
 * The box between two projected points with its label, tinted by direction (up colour when price rose). The label sits
 * outside the box on the side the price moved to, inside the plot where there is room.
 */
export function paintMeasure (
  ctx: CanvasRenderingContext2D,
  from: { readonly x: number, readonly y: number },
  to: { readonly x: number, readonly y: number },
  lines: readonly [string, string],
  rose: boolean | null,
  bounds: { readonly left: number, readonly right: number, readonly top: number, readonly bottom: number },
  theme: unknown
): void {
  const p = colors(theme), tone = rose === null ? p.flat : rose ? p.up : p.down
  const left = Math.min(from.x, to.x), right = Math.max(from.x, to.x), top = Math.min(from.y, to.y), bottom = Math.max(from.y, to.y)
  ctx.save()
  try {
    ctx.beginPath(); ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); ctx.clip()
    ctx.globalAlpha = 0.14; ctx.fillStyle = tone; ctx.fillRect(left, top, right - left, bottom - top)
    ctx.globalAlpha = 1; ctx.strokeStyle = tone; ctx.lineWidth = 1; ctx.setLineDash([])
    ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.max(0, right - left), Math.max(0, bottom - top))
    // The arrow runs along the price, through the middle of the box, to the end point.
    const mid = (left + right) / 2
    ctx.beginPath(); ctx.moveTo(mid, from.y); ctx.lineTo(mid, to.y)
    const dir = to.y < from.y ? -1 : 1
    if (to.y !== from.y) { ctx.moveTo(mid - 4, to.y - dir * 6); ctx.lineTo(mid, to.y); ctx.lineTo(mid + 4, to.y - dir * 6) }
    ctx.stroke()
    ctx.font = CANVAS_LABEL_FONT
    const width = Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1]).width) + 16, height = 38
    let x = Math.max(bounds.left + 4, Math.min(mid - width / 2, bounds.right - width - 4))
    let y = rose === false ? bottom + 8 : top - height - 8
    if (y < bounds.top + 2) y = bottom + 8
    if (y + height > bounds.bottom - 2) y = Math.max(bounds.top + 2, top - height - 8)
    ctx.fillStyle = tone; ctx.globalAlpha = 1
    ctx.beginPath(); ctx.roundRect(x, y, width, height, 4); ctx.fill()
    ctx.fillStyle = p.onMarket; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    x += width / 2
    ctx.font = CANVAS_FONT; ctx.fillText(lines[0], x, y + 12)
    ctx.font = CANVAS_LABEL_FONT; ctx.fillText(lines[1], x, y + 27)
  } finally { ctx.restore() }
}
