import type { DrawingCandidate, Point } from './recognizer'

/** Only a line ending at the right price axis promotes ray; a box/arrow keeps its stronger recognition. */
export function preferAxisRay (candidates: readonly DrawingCandidate[], endpoint: Point, right: number): DrawingCandidate[] {
  const result = candidates.slice()
  if (!Number.isFinite(right) || endpoint.x < right - 16 || (result[0]?.kind !== 'trend' && result[0]?.kind !== 'horizontal')) return result
  const ray = result.findIndex(c => c.kind === 'ray')
  if (ray > 0) result.unshift(...result.splice(ray, 1))
  return result
}

/** Nearby wick only: a horizontal stroke away from candles retains its intended price. */
export function snapHorizontalWick (anchor: Point, wicks: readonly Point[], tolerance = 12): Point {
  let result = anchor
  let best = tolerance
  for (const wick of wicks) {
    if (!Number.isFinite(wick.x) || !Number.isFinite(wick.y)) continue
    const distance = Math.hypot(anchor.x - wick.x, anchor.y - wick.y)
    if (distance < best) { result = { x: anchor.x, y: wick.y }; best = distance }
  }
  return result
}
