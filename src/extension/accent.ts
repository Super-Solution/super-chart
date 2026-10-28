/**
 * The accent in Super Chart's own drawing tools, resolved when they draw.
 *
 * A template's `styles` are fixed when it is registered, and klinecharts'
 * overlay registry is one global shared by every chart on the page (and by
 * hosts that drive klinecharts themselves). A colour written there cannot
 * follow a host's --klinecharts-pro-primary-color or a theme switch. So the
 * templates leave their accent colours out, and withAccent() adds them at draw
 * time from the chart's overlay defaults (`defaultStyles.line.color`), which
 * the Pro engine sets from its theme and the host's primary token. Built-in
 * klinecharts tools read the same defaults, so every tool on a chart draws in
 * one accent; on a raw klinecharts chart that is klinecharts' own default.
 *
 * Order, lowest first: the chart's overlay defaults, these accent styles, the
 * overlay's own styles (the drawing editor's colour choice, a host's
 * createOverlay styles), then what a figure hard-codes (fill vs stroke).
 * The drawing editor reads the same layers (accentStyles) so the colour it
 * shows is the colour drawn, and a new colour keeps the fill's opacity.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

import type { OverlayFigure, OverlayTemplate } from 'klinecharts'

import { parseColor, withAlpha } from '../drawing-editor/color'
import { inkOn } from '../theme/ink'
import { ACCENT } from '../theme/tokens'

type StyleRecord = Record<string, Record<string, unknown> | undefined>

/** The chart's drawing accent: its overlay line default, else ACCENT. */
export function drawingAccent (defaultStyles: unknown): string {
  const color = (defaultStyles as { line?: { color?: unknown } } | null | undefined)?.line?.color
  return typeof color === 'string' && parseColor(color) !== null ? color : ACCENT
}

const fill = (key: 'polygon' | 'circle', alpha: number) => (accent: string): StyleRecord => ({ [key]: { color: withAlpha(accent, alpha) } })
const box = (accent: string): StyleRecord => ({ text: { color: inkOn(accent), backgroundColor: accent } })

/**
 * Per template: the styles it takes from the accent. Translucent fills keep
 * their opacity; label boxes are the opaque accent with white or dark ink,
 * whichever reads better on it.
 */
const ACCENT_STYLES: Readonly<Record<string, (accent: string) => StyleRecord>> = {
  circle: fill('circle', 0.15),
  rect: fill('polygon', 0.15),
  triangle: fill('polygon', 0.15),
  parallelogram: fill('polygon', 0.15),
  gannBox: fill('polygon', 0.15),
  xabcd: fill('polygon', 0.15),
  ellipse: fill('polygon', 0.15),
  rotatedRect: fill('polygon', 0.15),
  gannSquare: fill('polygon', 0.1),
  disjointChannel: fill('polygon', 0.1),
  text: accent => ({ text: { color: accent } }),
  note: box,
  callout: box,
  priceLabel: box,
  signpost: box
}

/** The accent styles of a template (by overlay name) for an accent; {} for templates without any. */
export function accentStyles (name: string, accent: string): StyleRecord {
  const derive = Object.prototype.hasOwnProperty.call(ACCENT_STYLES, name) ? ACCENT_STYLES[name] : undefined
  return derive === undefined ? {} : derive(accent)
}

/** The template, drawing its accent styles under the overlay's own styles. Templates without accent styles are returned as they are. */
export function withAccent (template: OverlayTemplate): OverlayTemplate {
  const create = template.createPointFigures
  if (create === undefined || create === null || !Object.prototype.hasOwnProperty.call(ACCENT_STYLES, template.name)) {
    return template
  }
  return {
    ...template,
    createPointFigures: params => {
      const figures: OverlayFigure[] = ([] as OverlayFigure[]).concat(create(params))
      const derived = accentStyles(template.name, drawingAccent(params.defaultStyles))
      const own = params.overlay.styles as StyleRecord | null | undefined
      return figures.map(figure => {
        const accent = derived[figure.type]
        return accent === undefined ? figure : { ...figure, styles: { ...accent, ...own?.[figure.type], ...figure.styles } }
      })
    }
  }
}
