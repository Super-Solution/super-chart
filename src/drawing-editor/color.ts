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

import { ACCENT } from '../theme/tokens'

// Colour helpers for the drawing editor: parse the CSS colour strings klinecharts
// styles use (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()), re-format them, and build
// the palette the colour popover shows. Pure — no DOM, no klinecharts runtime.
// Part of SUPer-Chart (Apache-2.0).

export interface RGBA {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_FN_RE = /^rgba?\(\s*([^)]*)\)$/i

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
const round = (n: number, digits: number): number => {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}

function parseHex (body: string): RGBA {
  let h = body
  if (h.length <= 4) {
    h = h.split('').map(c => c + c).join('')
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? round(parseInt(h.slice(6, 8), 16) / 255, 3) : 1
  }
}

/** Parse a CSS colour string. Returns null for anything that is not a hex or rgb()/rgba() colour. */
export function parseColor (input: unknown): RGBA | null {
  if (typeof input !== 'string') {
    return null
  }
  const s = input.trim()
  const hex = HEX_RE.exec(s)
  if (hex !== null && s.startsWith('#')) {
    return parseHex(hex[1])
  }
  const fn = RGB_FN_RE.exec(s)
  if (fn !== null) {
    const parts = fn[1].split(/[\s,/]+/).filter(p => p.length > 0)
    if (parts.length < 3 || parts.length > 4) {
      return null
    }
    const channels = parts.slice(0, 3).map(p => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)))
    if (channels.some(n => !Number.isFinite(n))) {
      return null
    }
    let a = 1
    if (parts[3] !== undefined) {
      a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
      if (!Number.isFinite(a)) {
        return null
      }
    }
    return { r: clampByte(channels[0]), g: clampByte(channels[1]), b: clampByte(channels[2]), a: clamp01(a) }
  }
  return null
}

/**
 * Parse what a user typed into the custom-colour field: hex only, with or
 * without the leading '#'.
 */
export function parseHexInput (input: string): RGBA | null {
  const s = input.trim()
  const hex = HEX_RE.exec(s)
  return hex === null ? null : parseHex(hex[1])
}

const hex2 = (n: number): string => clampByte(n).toString(16).padStart(2, '0').toUpperCase()

/** '#RRGGBB' without alpha. */
export function toHex (c: RGBA): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
}

/** Opaque colours format as '#RRGGBB', translucent ones as 'rgba(r, g, b, a)'. */
export function formatColor (c: RGBA): string {
  const a = clamp01(c.a)
  if (a >= 1) {
    return toHex(c)
  }
  return `rgba(${clampByte(c.r)}, ${clampByte(c.g)}, ${clampByte(c.b)}, ${round(a, 2)})`
}

/** The colour's alpha (0..1), or null when the string is not a parseable colour. */
export function alphaOf (color: unknown): number | null {
  return parseColor(color)?.a ?? null
}

/** Same rgb, new alpha. Unparseable input is returned unchanged. */
export function withAlpha (color: string, alpha: number): string {
  const c = parseColor(color)
  return c === null ? color : formatColor({ ...c, a: alpha })
}

/** True when both colours parse and have the same rgb (alpha ignored). */
export function sameRgb (a: unknown, b: unknown): boolean {
  const ca = parseColor(a)
  const cb = parseColor(b)
  return ca !== null && cb !== null && ca.r === cb.r && ca.g === cb.g && ca.b === cb.b
}

/**
 * Preset swatches, TradingView-like: the accent, signal colours, then greys.
 * The first is the accent's slot: buildPalette puts the chart's drawing
 * default there, so a host accent replaces it rather than sitting next to it.
 */
export const PRESET_COLORS: readonly string[] = [
  ACCENT, '#089981', '#F23645', '#FF9800', '#FFEB3B', '#9C27B0', '#00BCD4', '#E91E63',
  '#4CAF50', '#795548', '#FFFFFF', '#B2B5BE', '#787B86', '#434651', '#131722'
]

/**
 * The palette the colour popover shows: the theme's default drawing colour
 * first (in the accent's slot), then the other presets, with duplicates (same
 * rgb) removed. Without a default colour the slot keeps ACCENT.
 */
export function buildPalette (defaultColor?: string | null): string[] {
  const out: string[] = []
  const push = (color: string): void => {
    const c = parseColor(color)
    if (c === null) {
      return
    }
    const hex = toHex(c)
    if (!out.some(existing => sameRgb(existing, hex))) {
      out.push(hex)
    }
  }
  const hasDefault = parseColor(defaultColor) !== null
  if (hasDefault) {
    push(defaultColor as string)
  }
  PRESET_COLORS.forEach((color, i) => {
    if (i > 0 || !hasDefault) {
      push(color)
    }
  })
  return out
}
