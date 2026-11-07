/** Extracted native viewport state transitions; no React Native, DOM or gestures. */
export interface Viewport { i0: number; i1: number }

export const MIN_BARS = 12;
/**
 * The opening window.
 *
 * At 200 bars in a 340pt plot a candle body is 1.1pt wide however tall the
 * viewer is — the reason the old chart read as a smear. At 90 it is ~2.5pt and
 * has a body you can see. The rail shows there is more to the left.
 */
export const DEFAULT_BARS = 90;

/** A phone opens with distinct candle bodies; a tablet can show more. */
export const openingBars = (plotWidth: number) => plotWidth > 1 ? Math.max(24, Math.min(DEFAULT_BARS, Math.floor(plotWidth / 5))) : DEFAULT_BARS;

export function fullViewport(n: number): Viewport {
  return { i0: 0, i1: Math.max(0, n - 1) };
}

export function defaultViewport(n: number, want: number = DEFAULT_BARS): Viewport {
  if (n <= 0) return { i0: 0, i1: 0 };
  const span = Math.max(1, Math.min(want, n));
  return clampViewport({ i0: n - span, i1: n - 1 }, n);
}

export function clampViewport(v: Viewport, n: number): Viewport {
  if (n <= 0) return { i0: 0, i1: 0 };
  const minSpan = Math.min(MIN_BARS, n);
  let i0 = Math.round(v.i0);
  let i1 = Math.round(v.i1);
  if (i1 < i0) [i0, i1] = [i1, i0];
  let span = Math.max(minSpan, Math.min(i1 - i0 + 1, n));
  i0 = Math.max(0, Math.min(i0, n - span));
  i1 = i0 + span - 1;
  if (i1 > n - 1) {
    i1 = n - 1;
    span = i1 - i0 + 1;
  }
  return { i0, i1 };
}

export function viewportSpan(v: Viewport): number {
  return v.i1 - v.i0 + 1;
}

/**
 * Zoom about a fraction of the current window.
 *
 * `factor > 1` zooms IN (fewer bars). The bar under `anchorFrac` stays under it,
 * which is what makes a pinch feel attached to the finger rather than to the
 * chart's centre.
 */
export function zoomViewport(v: Viewport, n: number, factor: number, anchorFrac: number): Viewport {
  if (n <= 0 || !Number.isFinite(factor) || factor <= 0) return clampViewport(v, n);
  const span = viewportSpan(v);
  const minSpan = Math.min(MIN_BARS, n);
  const nextSpan = Math.max(minSpan, Math.min(n, Math.round(span / factor)));
  const frac = Math.max(0, Math.min(1, anchorFrac));
  const anchor = v.i0 + frac * (span - 1);
  const i0 = Math.round(anchor - frac * (nextSpan - 1));
  return clampViewport({ i0, i1: i0 + nextSpan - 1 }, n);
}

/** Shift the window by whole bars. At either end this is a no-op, by design. */
export function panViewport(v: Viewport, n: number, deltaBars: number): Viewport {
  if (n <= 0 || !Number.isFinite(deltaBars)) return clampViewport(v, n);
  const d = Math.round(deltaBars);
  return clampViewport({ i0: v.i0 + d, i1: v.i1 + d }, n);
}

/** Horizontal drag distance, in bars of the current window. */
export function pxToBars(dxPx: number, v: Viewport, g: { plotW: number }): number {
  if (g.plotW <= 0) return 0;
  return (dxPx / g.plotW) * viewportSpan(v);
}

/** The filled part of the range rail: where this window sits in the whole series. */
export function railSegment(v: Viewport, n: number, width: number): { x: number; w: number } {
  if (n <= 0 || width <= 0) return { x: 0, w: width };
  const span = viewportSpan(v);
  const w = Math.max(6, (span / n) * width);
  const x = Math.max(0, Math.min(width - w, (v.i0 / n) * width));
  return { x, w };
}
