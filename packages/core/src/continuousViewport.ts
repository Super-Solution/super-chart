import { MIN_BARS, viewportSpan, type Viewport } from './viewport'

/** Fractional candle coordinates. Sampling stays integral; movement does not. */
export function clampContinuousViewport (value: Viewport, length: number): Viewport {
  if (length <= 0) return { i0: 0, i1: 0 }
  if (!Number.isFinite(value.i0) || !Number.isFinite(value.i1)) throw new RangeError('Viewport must be finite')
  const left = Math.min(value.i0, value.i1), right = Math.max(value.i0, value.i1)
  const span = Math.max(Math.min(MIN_BARS, length), Math.min(length, right - left + 1))
  const i0 = Math.max(0, Math.min(left, length - span))
  return { i0, i1: Math.min(length - 1, i0 + span - 1) }
}

export function zoomContinuousViewport (value: Viewport, length: number, factor: number, anchor: number): Viewport {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) return clampContinuousViewport(value, length)
  const fraction = Math.max(0, Math.min(1, anchor)), span = viewportSpan(value)
  const next = Math.max(Math.min(MIN_BARS, length), Math.min(length, span / factor))
  const i0 = value.i0 + fraction * (span - next)
  return clampContinuousViewport({ i0, i1: i0 + next - 1 }, length)
}
