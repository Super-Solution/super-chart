import type { DrawingAnchor, DrawingPoint, EngineFrame } from '@supersolutions/super-chart-core'

/** How close, in pixels, a pointer must be to a bar's open, high, low or close before the magnet takes hold. */
export const MAGNET_REACH = 24

/**
 * Snap a pointer position to the open, high, low or close of the bar next to it. Returns the anchor of that corner
 * when it is within `reach` pixels (the bar's own timestamp and the exact price), and the original anchor when
 * nothing is close enough, so a drawing is never pulled across the chart.
 */
export function snapToBar (frame: EngineFrame, point: DrawingPoint, anchor: DrawingAnchor, reach = MAGNET_REACH): DrawingAnchor {
  const bars = frame.drawingContext.bars
  if (bars.length === 0) return anchor
  let low = 0, high = bars.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (bars[mid].timestamp < anchor.timestamp) low = mid + 1; else high = mid
  }
  let best: DrawingAnchor | null = null, nearest = reach
  for (const index of [low - 1, low]) {
    const bar = bars[index]
    if (bar === undefined) continue
    for (const price of [bar.open, bar.high, bar.low, bar.close]) {
      const projected = frame.project(bar.timestamp, price)
      if (projected === null) continue
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
      if (distance < nearest) { nearest = distance; best = Object.freeze({ timestamp: bar.timestamp, price }) }
    }
  }
  return best ?? anchor
}
