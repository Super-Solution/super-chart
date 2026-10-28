/**
 * Text on a filled label (drawing labels, note and callout boxes): white or
 * dark ink, whichever has the higher WCAG contrast on the fill. The default
 * accent takes white (4.9:1); a light host accent such as #A0A8FF takes INK
 * (white on it would be 2.3:1).
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

import { parseColor } from '../drawing-editor/color'
import type { RGBA } from '../drawing-editor/color'
import { INK } from './tokens'

const WHITE = '#FFFFFF'

function luminance (c: RGBA): number {
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** '#FFFFFF' or INK for text on `fill` (its rgb; alpha is ignored). White when the fill does not parse. */
export function inkOn (fill: string): string {
  const c = parseColor(fill)
  const ink = parseColor(INK)
  if (c === null || ink === null) {
    return WHITE
  }
  const l = luminance(c)
  const onWhite = 1.05 / (l + 0.05)
  const onInk = (l + 0.05) / (luminance(ink) + 0.05)
  return onWhite >= onInk ? WHITE : INK
}
