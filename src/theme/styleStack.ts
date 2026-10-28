/**
 * The Pro engine's style stack. klinecharts has one flat styles object and
 * `setStyles(themeName)` merges a whole preset over it, so before this a
 * theme switch overwrote whatever the host had set (a grid colour, legend
 * icons, fonts). The stack keeps the layers apart and composes them in a
 * fixed order:
 *
 *   engine  (font, theme preset, canvas theme, chart type)  lowest
 *   host    (options.styles and pro.setStyles(styles))
 *   host, per theme (options.themeStyles, pro.setStyles(styles, { theme }))
 *   user    (the Settings modal)                            highest
 *
 * The whole stack is applied once at init and once per theme change. A change
 * to one layer between those (a chart-type switch, pro.setStyles) is applied
 * through over(), so the layers above it still win for the keys it sets.
 *
 * No layer keeps candle.type: the chart type has one owner (the chartType
 * option and the top bar). A host's candle.type is handed back by setHost()
 * so the engine can switch the chart type the way the top bar does.
 *
 * Styles a host sets on the raw chart (getChart().setStyles) are outside the
 * stack. A theme switch applies the whole engine theme, so it overwrites every
 * raw style on a key the engine theme sets (candles, last-price tag, grid,
 * axes, crosshair, indicator bars, legend icons, drawing defaults); a host
 * that uses that path re-applies after setTheme.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

import type { DeepPartial, Styles } from 'klinecharts'

import { mergeDeep } from '../common/object'
import { isChartType } from '../types'
import type { ChartType } from '../types'
import type { ThemeName } from './tokens'

type StylesLayer = DeepPartial<Styles>

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A style layer without candle.type, and the chart type it named (when it is one). */
export function splitChartType (styles: StylesLayer | null | undefined): { styles: StylesLayer, chartType?: ChartType } {
  const layer = styles ?? {}
  const candle = layer.candle
  if (candle === undefined || candle === null || !('type' in candle)) {
    return { styles: layer }
  }
  const { type, ...rest } = candle
  const { candle: _candle, ...others } = layer
  const out: StylesLayer = Object.keys(rest).length > 0 ? { ...others, candle: rest } : others
  return isChartType(type) ? { styles: out, chartType: type } : { styles: out }
}

/**
 * The parts of `source` at the paths `shape` sets. Plain objects recurse;
 * anything else (a colour, an array such as a gradient) is taken whole.
 */
export function pickPaths (source: unknown, shape: unknown): StylesLayer {
  const out: Record<string, unknown> = {}
  if (!isPlainObject(source) || !isPlainObject(shape)) {
    return out
  }
  for (const key of Object.keys(shape)) {
    if (!(key in source) || source[key] === undefined) {
      continue
    }
    const value = source[key]
    if (isPlainObject(value) && isPlainObject(shape[key])) {
      const picked = pickPaths(value, shape[key])
      if (Object.keys(picked).length > 0) {
        out[key] = picked
      }
    } else {
      out[key] = value
    }
  }
  return out
}

/** Which layer a change belongs to, for over(). */
export type StyleLevel = 'engine' | 'host' | 'theme'

/** Delete a path, and the objects it leaves empty. */
function deletePath (node: Record<string, any>, keys: string[]): void {
  const [head, ...rest] = keys
  if (head === undefined || !isPlainObject(node) || !(head in node)) {
    return
  }
  if (rest.length === 0) {
    delete node[head]
    return
  }
  const child = node[head]
  if (!isPlainObject(child)) {
    return
  }
  deletePath(child, rest)
  if (Object.keys(child).length === 0) {
    delete node[head]
  }
}

export class StyleStack {
  private _host: StylesLayer = {}
  private readonly _hostByTheme: Partial<Record<ThemeName, StylesLayer>> = {}
  private _user: StylesLayer = {}

  constructor (host?: StylesLayer | null, byTheme?: Partial<Record<ThemeName, StylesLayer>> | null) {
    this.addHost(host ?? {})
    for (const theme of ['light', 'dark'] as const) {
      const styles = byTheme?.[theme]
      if (styles !== undefined && styles !== null) {
        this.addHost(styles, theme)
      }
    }
  }

  /** Keep host styles (deep-merged into what the host set before), for every theme or one. candle.type is dropped. */
  addHost (styles: StylesLayer, theme?: ThemeName): void {
    const layer = splitChartType(styles).styles
    if (theme === undefined) {
      this._host = mergeDeep(this._host, layer)
    } else {
      this._hostByTheme[theme] = mergeDeep(this._hostByTheme[theme] ?? {}, layer)
    }
  }

  /**
   * pro.setStyles: keep the styles, and say what to do now. `apply` is what to
   * pass to setStyles (the styles, under the layers above them), or undefined
   * when nothing changes on the current theme. `chartType` is a host
   * candle.type for every theme, which switches the chart type instead of
   * being kept as a style.
   */
  setHost (styles: StylesLayer, theme: ThemeName | undefined, current: ThemeName): { apply?: StylesLayer, chartType?: ChartType } {
    const split = splitChartType(styles)
    this.addHost(split.styles, theme)
    const chartType = theme === undefined ? split.chartType : undefined
    if ((theme !== undefined && theme !== current) || Object.keys(split.styles).length === 0) {
      return { chartType }
    }
    return { apply: this.over(current, split.styles, theme === undefined ? 'host' : 'theme'), chartType }
  }

  /** Keep a change made in the Settings modal. */
  addUser (styles: StylesLayer): void {
    this._user = mergeDeep(this._user, splitChartType(styles).styles)
  }

  /** Settings > Restore defaults: forget the Settings values at these paths ('grid.show'). */
  clearUser (paths: string[]): void {
    for (const path of paths) {
      deletePath(this._user, path.split('.'))
    }
  }

  /** The host layers for a theme, in order. */
  host (theme: ThemeName): StylesLayer {
    return mergeDeep(this._host, this._hostByTheme[theme])
  }

  /**
   * `styles` from one layer, with the layers above it laid over the paths it
   * sets: what to apply now so the result equals what compose() gives for
   * those paths. A chart-type switch ('engine') keeps a host's area colours;
   * pro.setStyles ('host') keeps per-theme and Settings values on top.
   */
  over (theme: ThemeName, styles: StylesLayer, level: StyleLevel): StylesLayer {
    const above = level === 'engine'
      ? [this._host, this._hostByTheme[theme], this._user]
      : level === 'host' ? [this._hostByTheme[theme], this._user] : [this._user]
    return mergeDeep(styles, pickPaths(mergeDeep(...above), styles))
  }

  /** The engine layers (lowest first), then host, host-for-this-theme and user: one styles object. */
  compose (theme: ThemeName, engine: StylesLayer[]): StylesLayer {
    return mergeDeep(...engine, this._host, this._hostByTheme[theme], this._user)
  }
}
