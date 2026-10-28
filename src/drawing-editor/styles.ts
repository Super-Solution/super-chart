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

// Which style controls the drawing editor offers for an overlay, and how a change
// made in the toolbar becomes the `styles` object passed to overrideOverlay.
//
// Two klinecharts facts shape this module:
//  1. A figure is drawn with {...defaultStyles[type], ...overlay.styles[type],
//     ...figure.styles}. A value hardcoded in figure.styles always wins, so a
//     control is only offered where the overlay's figures leave that value to
//     overlay.styles (see PROFILES below).
//  2. klinecharts 9.1.1 REPLACES overlay.styles by reference (9.8 merges). A
//     template's styles object is shared by every instance of that template.
//     So a change is always applied to a deep copy of the current styles and the
//     whole, fresh object is sent — never a partial object, never a mutation.
//
// Pure — no DOM, no klinecharts runtime. Part of SUPer-Chart (Apache-2.0).

import { alphaOf, parseColor, withAlpha } from './color'
import { ACCENT } from '../theme/tokens'

/** Style keys whose stroke (colour / width / dash) the editor can change. */
export type StrokeKey = 'line' | 'arc' | 'polygon' | 'circle' | 'rect'
/** Style keys whose fill follows the line colour (the fill keeps its own opacity). */
export type FillKey = 'polygon' | 'circle' | 'rect'
/** Style keys that carry a text colour. */
export type TextKey = 'text' | 'rectText'

export interface StyleProfile {
  stroke: readonly StrokeKey[]
  fill: readonly FillKey[]
  text: readonly TextKey[]
  /**
   * Only the stroke's colour is editable: its width and dash are the tool's look
   * (the highlighter's broad translucent band), which the 1-4 px widths and the
   * dash patterns would destroy with no way back.
   */
  colorOnly?: boolean
}

export interface EditorControls {
  lineColor: boolean
  textColor: boolean
  lineWidth: boolean
  lineStyle: boolean
}

export type LineStyleKind = 'solid' | 'dashed' | 'dotted'

export const LINE_WIDTHS: readonly number[] = [1, 2, 3, 4]
export const LINE_STYLES: readonly LineStyleKind[] = ['solid', 'dashed', 'dotted']

/** klinecharts has only 'solid' and 'dashed'; 'dotted' is a short dash pattern. */
export const DASH_PATTERNS: { readonly dashed: readonly number[], readonly dotted: readonly number[] } = {
  dashed: [6, 4],
  dotted: [2, 2]
}

/** The dash klinecharts draws for style 'dashed' when no dash pattern is set (its default dashedValue [2, 2]). */
const KLINECHARTS_DEFAULT_DASH = 2

export type StyleChange =
  | { kind: 'lineColor', color: string }
  | { kind: 'textColor', color: string }
  | { kind: 'lineWidth', width: number }
  | { kind: 'lineStyle', style: LineStyleKind }

/** Loose view of klinecharts' DeepPartial<OverlayStyle> / OverlayStyle. */
export type StyleRecord = Record<string, Record<string, unknown> | undefined>

const NONE: StyleProfile = { stroke: [], fill: [], text: [] }
const LINE: StyleProfile = { stroke: ['line'], fill: [], text: [] }
const LINE_TEXT: StyleProfile = { stroke: ['line'], fill: [], text: ['text'] }
const LINE_FILL: StyleProfile = { stroke: ['line'], fill: ['polygon'], text: [] }
const POLYGON: StyleProfile = { stroke: ['polygon'], fill: ['polygon'], text: [] }
const TEXT: StyleProfile = { stroke: [], fill: [], text: ['text'] }
const LINE_COLOR_ONLY: StyleProfile = { stroke: ['line'], fill: [], text: [], colorOnly: true }

/**
 * Per drawing-bar tool: which style keys its figures leave to overlay.styles.
 * Tools not listed (klinecharts' built-in straight/ray/segment/channel lines)
 * get LINE. Tools whose colours carry meaning (long/short zones, measure boxes,
 * forecast up/down, volume profiles, VWAP, regression) or that draw an image
 * get NONE: lock, delete and the "more" menu still apply to them.
 */
const PROFILES: Record<string, StyleProfile> = {
  // klinecharts built-ins that also draw text
  priceLine: LINE_TEXT,
  fibonacciLine: LINE_TEXT,

  // single lines / curves
  arrow: LINE,
  curve: LINE,
  arc: LINE,
  doubleCurve: LINE,
  pitchfork: LINE,
  schiff: LINE,
  modifiedSchiff: LINE,
  gannFan: LINE,
  fibonacciTimeZone: LINE,
  fibonacciSpeedResistanceArc: LINE,
  brush: LINE,
  // a 12 px translucent band: colour (and its opacity) only
  highlighter: LINE_COLOR_ONLY,

  // markers drawn as a filled shape: the colour control paints the fill
  arrowUp: { stroke: [], fill: ['polygon'], text: [] },
  arrowDown: { stroke: [], fill: ['polygon'], text: [] },
  pin: { stroke: [], fill: ['polygon', 'circle'], text: [] },
  flag: LINE_FILL,

  // shapes
  circle: { stroke: ['circle'], fill: ['circle'], text: [] },
  rect: POLYGON,
  triangle: POLYGON,
  ellipse: POLYGON,
  rotatedRect: POLYGON,
  parallelogram: POLYGON,
  gannBox: LINE_FILL,
  gannSquare: LINE_FILL,
  disjointChannel: LINE_FILL,

  // fibonacci / waves with level or wave labels
  fibonacciSegment: LINE_TEXT,
  fibonacciSpeedResistanceFan: LINE_TEXT,
  fibonacciExtension: LINE_TEXT,
  fibonacciCircle: { stroke: ['circle'], fill: [], text: ['text'] },
  fibonacciSpiral: { stroke: ['arc', 'line'], fill: [], text: [] },
  threeWaves: LINE_TEXT,
  fiveWaves: LINE_TEXT,
  eightWaves: LINE_TEXT,
  anyWaves: LINE_TEXT,
  abcd: LINE_TEXT,
  xabcd: { stroke: ['line'], fill: ['polygon'], text: ['text'] },

  // text tools
  text: TEXT,
  note: TEXT,
  priceLabel: TEXT,
  callout: LINE_TEXT,
  signpost: LINE_TEXT,

  // fixed, meaningful colours
  positionLong: NONE,
  positionShort: NONE,
  priceRange: NONE,
  dateRange: NONE,
  priceDateRange: NONE,
  forecast: NONE,
  anchoredVWAP: NONE,
  fixedRangeVolumeProfile: NONE,
  anchoredVolumeProfile: NONE,
  regressionTrend: NONE,
  image: NONE
}

export function profileFor (name: string): StyleProfile {
  return Object.prototype.hasOwnProperty.call(PROFILES, name) ? PROFILES[name] : LINE
}

export function controlsFor (profile: StyleProfile): EditorControls {
  const stroke = profile.stroke.length > 0
  const shape = stroke && profile.colorOnly !== true
  return {
    lineColor: stroke || profile.fill.length > 0,
    textColor: profile.text.length > 0,
    lineWidth: shape,
    lineStyle: shape
  }
}

export function editorControlsFor (name: string): EditorControls {
  return controlsFor(profileFor(name))
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype

/** Deep copy of plain objects / arrays; anything else (e.g. a CanvasGradient) is kept by reference. */
export function deepClone<T> (value: T): T {
  if (Array.isArray(value)) {
    return value.map(v => deepClone(v)) as unknown as T
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    Object.keys(value).forEach(k => { out[k] = deepClone(value[k]) })
    return out as T
  }
  return value
}

/** Returns a NEW object: `target` deep-merged with `patch` (arrays are replaced). Neither input is mutated. */
export function deepMerge<T extends Record<string, unknown>> (target: T | null | undefined, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = isPlainObject(target) ? deepClone(target) : {}
  Object.keys(patch).forEach(k => {
    const pv = patch[k]
    if (pv === undefined) {
      return
    }
    const tv = out[k]
    out[k] = isPlainObject(pv) && isPlainObject(tv) ? deepMerge(tv, pv) : deepClone(pv)
  })
  return out as T
}

/**
 * Which toolbar style a stroke shows: 'dashed' strokes are told apart by their
 * first dash, whichever of DASH_PATTERNS it is nearer to (a tie counts as
 * dashed), so whatever the toolbar writes reads back as what the user picked.
 */
export function classifyLineStyle (style: unknown, dashedValue: unknown): LineStyleKind {
  if (style !== 'dashed') {
    return 'solid'
  }
  const first = Array.isArray(dashedValue) && typeof dashedValue[0] === 'number' ? dashedValue[0] : KLINECHARTS_DEFAULT_DASH
  return Math.abs(first - DASH_PATTERNS.dotted[0]) < Math.abs(first - DASH_PATTERNS.dashed[0]) ? 'dotted' : 'dashed'
}

const isLineKey = (key: StrokeKey): boolean => key === 'line' || key === 'arc'

function effective (styles: StyleRecord | null | undefined, defaults: StyleRecord | null | undefined, key: string): Record<string, unknown> {
  return { ...(defaults?.[key] ?? {}), ...(styles?.[key] ?? {}) }
}

const FALLBACK_COLOR = ACCENT

export interface StrokeState {
  color: string
  width: number
  style: LineStyleKind
}

/** What the toolbar buttons show: read from the first stroke key (or the first fill key for fill-only markers). */
export function readStrokeState (styles: StyleRecord | null | undefined, defaults: StyleRecord | null | undefined, profile: StyleProfile): StrokeState {
  const key = profile.stroke[0]
  if (key !== undefined) {
    const s = effective(styles, defaults, key)
    if (isLineKey(key)) {
      return {
        color: typeof s.color === 'string' ? s.color : FALLBACK_COLOR,
        width: typeof s.size === 'number' ? s.size : 1,
        style: classifyLineStyle(s.style, s.dashedValue)
      }
    }
    return {
      color: typeof s.borderColor === 'string' ? s.borderColor : FALLBACK_COLOR,
      width: typeof s.borderSize === 'number' ? s.borderSize : 1,
      style: classifyLineStyle(s.borderStyle, s.borderDashedValue)
    }
  }
  const fillKey = profile.fill[0]
  if (fillKey !== undefined) {
    const s = effective(styles, defaults, fillKey)
    return { color: typeof s.color === 'string' ? s.color : FALLBACK_COLOR, width: 1, style: 'solid' }
  }
  return { color: FALLBACK_COLOR, width: 1, style: 'solid' }
}

export function readTextColor (styles: StyleRecord | null | undefined, defaults: StyleRecord | null | undefined, profile: StyleProfile): string {
  const key = profile.text[0]
  if (key === undefined) {
    return FALLBACK_COLOR
  }
  const s = effective(styles, defaults, key)
  return typeof s.color === 'string' ? s.color : FALLBACK_COLOR
}

/**
 * The partial styles object a change produces for this overlay's figures.
 * - lineColor: line/arc `color`, polygon/circle/rect `borderColor`; fills take the
 *   new rgb but keep their own opacity (a fill-only marker takes the colour as is).
 * - lineWidth: line/arc `size`, polygon/circle/rect `borderSize`.
 * - lineStyle: `style`/`dashedValue` (or `borderStyle`/`borderDashedValue`).
 * - textColor: text/rectText `color`.
 */
export function buildStylePatch (
  profile: StyleProfile,
  change: StyleChange,
  current: StyleRecord | null | undefined,
  defaults: StyleRecord | null | undefined
): StyleRecord {
  const patch: StyleRecord = {}
  const set = (key: string, values: Record<string, unknown>): void => {
    patch[key] = { ...(patch[key] ?? {}), ...values }
  }
  switch (change.kind) {
    case 'lineColor': {
      if (parseColor(change.color) === null) {
        return patch
      }
      profile.stroke.forEach(key => {
        set(key, isLineKey(key) ? { color: change.color } : { borderColor: change.color })
      })
      const fillOnly = profile.stroke.length === 0
      profile.fill.forEach(key => {
        if (fillOnly) {
          set(key, { color: change.color })
          return
        }
        const fillAlpha = alphaOf(effective(current, defaults, key).color)
        if (fillAlpha !== null) {
          set(key, { color: withAlpha(change.color, fillAlpha) })
        }
      })
      break
    }
    case 'textColor': {
      if (parseColor(change.color) === null) {
        return patch
      }
      profile.text.forEach(key => { set(key, { color: change.color }) })
      break
    }
    case 'lineWidth': {
      if (!Number.isFinite(change.width) || change.width <= 0 || profile.colorOnly === true) {
        return patch
      }
      profile.stroke.forEach(key => {
        set(key, isLineKey(key) ? { size: change.width } : { borderSize: change.width })
      })
      break
    }
    case 'lineStyle': {
      if (profile.colorOnly === true) {
        return patch
      }
      const dashed = change.style !== 'solid'
      const pattern = change.style === 'solid' ? undefined : [...DASH_PATTERNS[change.style]]
      profile.stroke.forEach(key => {
        if (isLineKey(key)) {
          set(key, dashed ? { style: 'dashed', dashedValue: pattern } : { style: 'solid' })
        } else {
          set(key, dashed ? { borderStyle: 'dashed', borderDashedValue: pattern } : { borderStyle: 'solid' })
        }
      })
      break
    }
  }
  return patch
}

/**
 * The complete, fresh styles object to send as overrideOverlay({ id, styles }).
 * `current` (overlay.styles, possibly a template's shared object) is never mutated.
 */
export function applyStyleChange (
  current: StyleRecord | null | undefined,
  defaults: StyleRecord | null | undefined,
  profile: StyleProfile,
  change: StyleChange
): StyleRecord {
  return deepMerge<StyleRecord>(current ?? {}, buildStylePatch(profile, change, current, defaults))
}
