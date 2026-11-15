import { resolveViewportLimits, viewportSpan, type Viewport, type ViewportLimits } from './viewport'

/** Fractional candle coordinates. Sampling stays integral; movement does not. */
export function clampContinuousViewport (value: Viewport, length: number, limits?: ViewportLimits): Viewport {
  if (length <= 0) return { i0: 0, i1: 0 }
  if (!Number.isFinite(value.i0) || !Number.isFinite(value.i1)) throw new RangeError('Viewport must be finite')
  const left = Math.min(value.i0, value.i1), right = Math.max(value.i0, value.i1)
  const bounds = resolveViewportLimits(limits)
  const extent = Math.min(Number.MAX_SAFE_INTEGER, length + bounds.rightPaddingBars)
  const span = Math.max(Math.min(bounds.minBars, extent), Math.min(extent, bounds.maxBars, right - left + 1))
  // Always retain at least the latest real candle; padding is empty space, not data.
  const i0 = Math.max(0, Math.min(left, extent - span, length - 1))
  return { i0, i1: Math.min(extent - 1, i0 + span - 1) }
}

export function zoomContinuousViewport (value: Viewport, length: number, factor: number, anchor: number, limits?: ViewportLimits): Viewport {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) return clampContinuousViewport(value, length, limits)
  const fraction = Math.max(0, Math.min(1, anchor)), span = viewportSpan(value)
  const bounds = resolveViewportLimits(limits)
  const extent = Math.min(Number.MAX_SAFE_INTEGER, length + bounds.rightPaddingBars)
  const next = Math.max(Math.min(bounds.minBars, extent), Math.min(extent, bounds.maxBars, span / factor))
  const i0 = value.i0 + fraction * (span - next)
  return clampContinuousViewport({ i0, i1: i0 + next - 1 }, length, limits)
}
